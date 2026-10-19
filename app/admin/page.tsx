"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/app/utils/supabase/client";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import { DEFAULT_ESTIMATE_TRADES, parseEstimateTradeOptions } from "@/lib/estimate-trades";
import CronJobsPanel from "@/app/admin/CronJobsPanel";
import AiMatchMetricsPanel from "@/app/admin/AiMatchMetricsPanel";

type AdminRole = "support" | "billing" | "super_admin";
type AdminTab = "accounts" | "billing" | "settings" | "ai" | "cron";
type Account = {
  id: string;
  email: string;
  business_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  plan_status: string;
  current_period_end: string | null;
  has_stripe_customer: boolean;
  has_stripe_subscription: boolean;
};
type AccountDetail = {
  account: { id: string; email: string; business_name: string; created_at: string; last_sign_in_at: string | null; last_active_at: string | null; deletion_status: "active" | "pending_deletion" | "deleting"; deletion_notice_sent_at: string | null; deletion_due_at: string | null; is_admin: boolean; email_confirmed_at: string | null; status: string; current_period_end: string | null; banned_until: string | null; has_stripe_subscription: boolean; subscription_updated_at: string | null; active_pro_grant: ProGrant | null };
  ai_usage: { daily_date: string; daily_used: number; daily_limit: number; monthly_month: string; monthly_used: number; monthly_limit: number } | null;
  pro_grants: ProGrant[];
  notes: { id: string; note: string; category: string; created_at: string; actor_user_id: string | null; actor_email: string | null }[];
  audit: { id: string; action: string; reason: string; outcome: string; details: Record<string, unknown>; created_at: string; actor_user_id: string | null; actor_email: string | null }[];
  questions: { id: string; estimate_id: string; customer_name: string; customer_email: string; message: string; created_at: string; read_at: string | null }[];
  email_events: { id: string; estimate_id: string; recipient: string; event: string; created_at: string }[];
};
type ProGrant = { id: string; grant_type: "temporary" | "permanent"; reason: string; created_at: string; starts_at: string; expires_at: string | null; revoked_at: string | null; is_expired: boolean };
type AiDraftingSettings = { ai_drafting_enabled: boolean; ai_daily_generation_limit: number; ai_monthly_generation_limit: number; ai_global_daily_generation_limit: number; today: { attempts_started: number; succeeded: number; failed: number; global_attempts_started: number }; this_month: { attempts_started: number } };
type AppEmailSettings = { daily_limit: number; today: { emails_started: number } };
type AccountEmailLimits = { free_email_daily_limit: number; free_email_monthly_limit: number; pro_email_daily_limit: number; pro_email_monthly_limit: number };
type AccountStats = { created: number; email_verified: number; signed_in: number };
type RecoverySummary = {
  counts: { past_due: number; in_grace: number; grace_ended: number; retry_scheduled: number; recovered_this_month: number };
  invoices: { invoice_id: string; email: string; status: string; amount_due: number; currency: string; attempt_count: number; next_retry_at: string | null; first_failed_at: string | null; last_failed_at: string | null; paid_at: string | null }[];
};

const ADMIN_MFA_REQUIRED_EVENT = "workcraft:admin-mfa-required";

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function adminPlanStatus(account: AccountDetail["account"]) {
  if (account.active_pro_grant && !["active", "trialing"].includes(account.status)) {
    return account.active_pro_grant.grant_type === "permanent"
      ? "Pro · admin grant"
      : "Pro · temporary grant";
  }
  return account.status;
}

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (result.code === "mfa_required" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(ADMIN_MFA_REQUIRED_EVENT));
    }
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

export default function AdminPage() {
  const { language } = useLanguage();
  const [role, setRole] = useState<AdminRole | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("accounts");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerifiedFactor, setMfaVerifiedFactor] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [accessState, setAccessState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [accountStats, setAccountStats] = useState<AccountStats | null>(null);
  const [accountStatsError, setAccountStatsError] = useState("");
  const [recovery, setRecovery] = useState<RecoverySummary | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [noteCategory, setNoteCategory] = useState("support");
  const [noteReason, setNoteReason] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [couponId, setCouponId] = useState("");
  const [billingReason, setBillingReason] = useState("");
  const [proGrantType, setProGrantType] = useState<"temporary" | "permanent">("temporary");
  const [proGrantDurationDays, setProGrantDurationDays] = useState("30");
  const [proAccessReason, setProAccessReason] = useState("");
  const [freeEstimateLimit, setFreeEstimateLimit] = useState<number | null>(null);
  const [freeEstimateLimitInput, setFreeEstimateLimitInput] = useState("");
  const [freeEstimateLimitReason, setFreeEstimateLimitReason] = useState("");
  const [freeEstimateLimitLoading, setFreeEstimateLimitLoading] = useState(false);
  const [aiDraftingSettings, setAiDraftingSettings] = useState<AiDraftingSettings | null>(null);
  const [aiDailyLimitInput, setAiDailyLimitInput] = useState("");
  const [aiGlobalDailyLimitInput, setAiGlobalDailyLimitInput] = useState("");
  const [aiSettingsReason, setAiSettingsReason] = useState("");
  const [aiSettingsLoading, setAiSettingsLoading] = useState(true);
  const [appEmailSettings, setAppEmailSettings] = useState<AppEmailSettings | null>(null);
  const [appEmailLimitInput, setAppEmailLimitInput] = useState("");
  const [appEmailLimitReason, setAppEmailLimitReason] = useState("");
  const [appEmailSettingsLoading, setAppEmailSettingsLoading] = useState(true);
  const [accountEmailLimits, setAccountEmailLimits] = useState<AccountEmailLimits | null>(null);
  const [accountEmailInputs, setAccountEmailInputs] = useState({ free_daily: "0", free_monthly: "0", pro_daily: "5", pro_monthly: "100" });
  const [accountEmailReason, setAccountEmailReason] = useState("");
  const [estimateTradeOptions, setEstimateTradeOptions] = useState(DEFAULT_ESTIMATE_TRADES.map((option) => ({ ...option })));
  const [estimateTradeOptionsLoading, setEstimateTradeOptionsLoading] = useState(true);
  const [estimateTradeOptionsReason, setEstimateTradeOptionsReason] = useState("");
  const [aiUsageResetReason, setAiUsageResetReason] = useState("");
  const [deletionConfirmEmail, setDeletionConfirmEmail] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [retentionReason, setRetentionReason] = useState("");

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setError("");
    setDeletionConfirmEmail("");
    setDeletionReason("");
    setRetentionReason("");
    setAiUsageResetReason("");
    try {
      setDetail(await requestJson(`/api/admin/accounts/${encodeURIComponent(id)}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this account.");
    }
  }, []);

  useEffect(() => {
    void requestJson("/api/admin/me").then((result) => {
      setRole(result.role);
      setMfaRequired(Boolean(result.mfa_required));
      setAccessState("ready");
    }).catch((cause) => {
      setAccessState(cause instanceof Error && cause.message.includes("not authorized") ? "denied" : "error");
      setError(cause instanceof Error ? cause.message : "Admin access could not be checked.");
    });
  }, []);

  useEffect(() => {
    const handleMfaRequired = () => {
      setError("");
      setMfaRequired(true);
    };
    window.addEventListener(ADMIN_MFA_REQUIRED_EVENT, handleMfaRequired);
    return () => window.removeEventListener(ADMIN_MFA_REQUIRED_EVENT, handleMfaRequired);
  }, []);

  useEffect(() => {
    if (!mfaRequired) return;
    let cancelled = false;
    void createClient().auth.mfa.listFactors().then(({ data }) => {
      if (cancelled || !data) return;
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setMfaFactorId(verified.id);
        setMfaVerifiedFactor(true);
      }
    });
    return () => { cancelled = true; };
  }, [mfaRequired]);

  useEffect(() => {
    if (!role || mfaRequired) return;
    let cancelled = false;
    void requestJson("/api/admin/account-stats").then((result: AccountStats) => {
      if (!cancelled) setAccountStats(result);
    }).catch(() => {
      if (!cancelled) setAccountStatsError("Could not load account totals. Refresh the page to try again.");
    });
    return () => { cancelled = true; };
  }, [role, mfaRequired]);

  const loadRecovery = useCallback(async () => {
    try {
      setRecoveryError("");
      setRecovery(await requestJson("/api/admin/subscription-recovery") as RecoverySummary);
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : "Could not load subscription recovery.");
    }
  }, []);

  useEffect(() => {
    if (!role || role === "support" || mfaRequired) return;
    void loadRecovery();
  }, [role, mfaRequired, loadRecovery]);

  useEffect(() => {
    if (role !== "super_admin") return;
    let cancelled = false;
    void requestJson("/api/admin/free-estimate-limit").then((result) => {
      if (cancelled) return;
      setFreeEstimateLimit(result.limit);
      setFreeEstimateLimitInput(String(result.limit));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the free estimate limit.");
    }).finally(() => {
      if (!cancelled) setFreeEstimateLimitLoading(false);
    });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (role !== "super_admin") return;
    let cancelled = false;
    void requestJson("/api/admin/ai-drafting-settings").then((result) => {
      if (cancelled) return;
      setAiDraftingSettings(result);
      setAiDailyLimitInput(String(result.ai_daily_generation_limit));
      setAiGlobalDailyLimitInput(String(result.ai_global_daily_generation_limit));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load AI drafting settings.");
    }).finally(() => {
      if (!cancelled) setAiSettingsLoading(false);
    });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (role !== "super_admin") return;
    let cancelled = false;
    void requestJson("/api/admin/email-daily-limit").then((result) => {
      if (cancelled) return;
      setAppEmailSettings(result);
      setAppEmailLimitInput(String(result.daily_limit));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the app email limit.");
    }).finally(() => {
      if (!cancelled) setAppEmailSettingsLoading(false);
    });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (role !== "super_admin") return;
    let cancelled = false;
    void requestJson("/api/admin/account-email-limits").then((result: AccountEmailLimits) => {
      if (cancelled) return;
      setAccountEmailLimits(result);
      setAccountEmailInputs({ free_daily: String(result.free_email_daily_limit), free_monthly: String(result.free_email_monthly_limit), pro_daily: String(result.pro_email_daily_limit), pro_monthly: String(result.pro_email_monthly_limit) });
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load account email allowances.");
    });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (role !== "super_admin") return;
    let cancelled = false;
    void requestJson("/api/admin/trades").then((result) => {
      if (cancelled) return;
      const options = parseEstimateTradeOptions(result.trades);
      if (options) setEstimateTradeOptions(options);
      else setError("The saved estimate trade list is invalid. Update it before continuing.");
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load estimate trade options.");
    }).finally(() => {
      if (!cancelled) setEstimateTradeOptionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [role]);

  const beginMfaSetup = async () => {
    setMfaBusy(true);
    setMfaError("");
    try {
      const { data, error: enrollError } = await createClient().auth.mfa.enroll({ factorType: "totp", friendlyName: "WorkCraft AI admin" });
      if (enrollError || !data) throw enrollError || new Error("Could not start authenticator setup.");
      setMfaFactorId(data.id);
      setMfaQrCode(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaVerifiedFactor(false);
    } catch (cause) {
      setMfaError(cause instanceof Error ? cause.message : "Could not start MFA setup.");
    } finally {
      setMfaBusy(false);
    }
  };

  const verifyMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (!mfaFactorId || !/^\d{6}$/.test(mfaCode)) return;
    setMfaBusy(true);
    setMfaError("");
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code: mfaCode });
      if (verifyError) throw verifyError;
      const result = await requestJson("/api/admin/me");
      setMfaRequired(Boolean(result.mfa_required));
      setMfaVerifiedFactor(true);
      setError("");
      setMfaQrCode("");
      setMfaSecret("");
      setMfaCode("");
    } catch (cause) {
      setMfaError(cause instanceof Error ? cause.message : "That authenticator code could not be verified.");
    } finally {
      setMfaBusy(false);
    }
  };

  const searchAccounts = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSearching(true);
    setAccounts([]);
    setSelectedId("");
    setDetail(null);
    try {
      const result = await requestJson(`/api/admin/accounts?q=${encodeURIComponent(search.trim())}`);
      setAccounts(result.accounts);
      if (!result.accounts.length) setNotice("No matching account was found.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account search failed.");
    } finally {
      setSearching(false);
    }
  };

  const runAction = async (name: string, url: string, payload: Record<string, unknown>, successMessage: string): Promise<boolean> => {
    if (!selectedId) return false;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const result = await requestJson(url, { method: "POST", body: JSON.stringify(payload) });
      setNotice(result.message || successMessage);
      await loadDetail(selectedId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
      return false;
    } finally {
      setBusy("");
    }
  };

  const saveNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim() || !noteReason.trim()) return;
    void runAction("note", `/api/admin/accounts/${encodeURIComponent(selectedId)}/notes`, { note, category: noteCategory, reason: noteReason }, "Support note saved.").then((saved) => {
      if (saved) { setNote(""); setNoteCategory("support"); setNoteReason(""); }
    });
  };

  const sendRecovery = () => {
    if (!selectedId || !recoveryReason.trim()) return;
    if (!window.confirm(`Send a password recovery email to ${detail?.account.email}?`)) return;
    void runAction("recovery", `/api/admin/accounts/${encodeURIComponent(selectedId)}/reset-password`, { reason: recoveryReason }, "Recovery email requested.").then((sent) => { if (sent) setRecoveryReason(""); });
  };

  const resetAccountAiUsage = () => {
    if (!selectedId || !detail || aiUsageResetReason.trim().length < 8) return;
    const confirmation = translate(language, "Reset this account’s current daily and monthly AI counts? Its usage history, provider token totals, and the shared platform limit will remain unchanged.");
    if (!window.confirm(confirmation)) return;
    void runAction("ai-usage-reset", `/api/admin/accounts/${encodeURIComponent(selectedId)}/ai-usage`, { reason: aiUsageResetReason }, "AI allowance counts reset. Usage history and the platform-wide limit are unchanged.").then((reset) => {
      if (reset) setAiUsageResetReason("");
    });
  };

  const applyCoupon = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !couponId.trim() || !billingReason.trim()) return;
    if (!window.confirm("Apply this existing 100% Stripe coupon to the customer’s subscription?")) return;
    void runAction("billing", `/api/admin/accounts/${encodeURIComponent(selectedId)}/billing`, { coupon_id: couponId, reason: billingReason }, "Stripe discount applied.").then((applied) => {
      if (applied) { setCouponId(""); setBillingReason(""); }
    });
  };

  const saveProAccess = (event: FormEvent) => {
    event.preventDefault();
    const duration = Number(proGrantDurationDays);
    if (!selectedId || proAccessReason.trim().length < 8
      || (proGrantType === "temporary" && (!Number.isInteger(duration) || duration < 1 || duration > 365))) return;
    void runAction("pro-access", `/api/admin/accounts/${encodeURIComponent(selectedId)}/pro-access`, {
      operation: "grant", grant_type: proGrantType,
      duration_days: proGrantType === "temporary" ? duration : null,
      reason: proAccessReason,
    }, "Pro access granted.").then((granted) => {
      if (granted) setProAccessReason("");
    });
  };

  const revokeProAccess = () => {
    if (!selectedId || !detail?.account.active_pro_grant || proAccessReason.trim().length < 8) return;
    if (!window.confirm(`Revoke admin-granted Pro access for ${detail.account.email}?`)) return;
    void runAction("pro-access", `/api/admin/accounts/${encodeURIComponent(selectedId)}/pro-access`, {
      operation: "revoke", reason: proAccessReason,
    }, "Admin-granted Pro access revoked.").then((revoked) => {
      if (revoked) setProAccessReason("");
    });
  };

  const deleteSelectedAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || role !== "super_admin" || detail.account.is_admin || deletionReason.trim().length < 8) return;
    if (deletionConfirmEmail.trim().toLowerCase() !== detail.account.email.toLowerCase()) {
      setError("Type the account email exactly to confirm deletion.");
      return;
    }
    const accepted = window.confirm(`Permanently delete ${detail.account.email} and its WorkCraft AI data? This cannot be undone. The contractor’s separate Stripe account will not be deleted.`);
    if (!accepted) return;
    setBusy("account-deletion");
    setError("");
    setNotice("");
    try {
      const result = await requestJson(`/api/admin/accounts/${encodeURIComponent(selectedId)}/delete`, {
        method: "POST", body: JSON.stringify({ confirm_email: deletionConfirmEmail, reason: deletionReason }),
      });
      setNotice(result.message || "The account was deleted.");
      setAccounts((previous) => previous.filter((account) => account.id !== selectedId));
      setSelectedId("");
      setDetail(null);
      setDeletionConfirmEmail("");
      setDeletionReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account could not be deleted.");
    } finally {
      setBusy("");
    }
  };

  const cancelPendingDeletion = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || role !== "super_admin" || retentionReason.trim().length < 8) return;
    void runAction("retention", `/api/admin/accounts/${encodeURIComponent(selectedId)}/retention`, { action: "cancel_pending_deletion", reason: retentionReason }, "Pending deletion canceled.").then((canceled) => { if (canceled) setRetentionReason(""); });
  };

  const adminTabs = [
    { id: "accounts" as const, label: language === "es" ? "Cuentas" : "Accounts", controls: "accounts-summary-panel accounts-records-panel" },
    ...(role !== "support" ? [{ id: "billing" as const, label: language === "es" ? "Facturación" : "Billing", controls: "billing-panel" }] : []),
    ...(role === "super_admin" ? [{ id: "settings" as const, label: language === "es" ? "Configuración" : "Settings", controls: "settings-panel" }] : []),
    ...(role === "super_admin" ? [{ id: "ai" as const, label: language === "es" ? "IA generativa" : "Generative AI", controls: "ai-panel" }] : []),
    { id: "cron" as const, label: language === "es" ? "Tareas programadas" : "Cron jobs", controls: "cron-panel" },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: AdminTab) => {
    const currentIndex = adminTabs.findIndex((tab) => tab.id === currentTab);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % adminTabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + adminTabs.length) % adminTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? adminTabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = adminTabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`admin-tab-${nextTab.id}`)?.focus();
  };

  const saveFreeEstimateLimit = async (event: FormEvent) => {
    event.preventDefault();
    if (!freeEstimateLimitInput.trim()) return;
    const parsedLimit = Number(freeEstimateLimitInput);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0 || parsedLimit > 10 || freeEstimateLimitReason.trim().length < 8) return;
    setBusy("free-estimate-limit");
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/admin/free-estimate-limit", {
        method: "POST",
        body: JSON.stringify({ limit: parsedLimit, reason: freeEstimateLimitReason }),
      });
      setFreeEstimateLimit(result.limit);
      setFreeEstimateLimitInput(String(result.limit));
      setFreeEstimateLimitReason("");
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the free estimate limit.");
    } finally {
      setBusy("");
    }
  };

  const saveAiDraftingSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!aiDraftingSettings || !aiDailyLimitInput.trim() || !aiGlobalDailyLimitInput.trim()) return;
    const parsedLimit = Number(aiDailyLimitInput);
    const parsedGlobalLimit = Number(aiGlobalDailyLimitInput);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5 || !Number.isInteger(parsedGlobalLimit) || parsedGlobalLimit < 1 || parsedGlobalLimit > 5000 || aiSettingsReason.trim().length < 8) return;
    setBusy("ai-drafting-settings");
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/admin/ai-drafting-settings", {
        method: "POST",
        body: JSON.stringify({ enabled: aiDraftingSettings.ai_drafting_enabled, daily_limit: parsedLimit, global_daily_limit: parsedGlobalLimit, reason: aiSettingsReason }),
      });
      setAiDraftingSettings((previous) => previous ? { ...previous, ai_drafting_enabled: result.enabled, ai_daily_generation_limit: result.daily_limit, ai_global_daily_generation_limit: result.global_daily_limit } : previous);
      setAiDailyLimitInput(String(result.daily_limit));
      setAiGlobalDailyLimitInput(String(result.global_daily_limit));
      setAiSettingsReason("");
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update AI drafting settings.");
    } finally {
      setBusy("");
    }
  };

  const setAiDraftingEnabled = async (enabled: boolean) => {
    if (!aiDraftingSettings || aiSettingsReason.trim().length < 8) return;
    setBusy("ai-drafting-settings");
    setError("");
    setNotice("");
    try {
      const limit = Number(aiDailyLimitInput);
      const globalLimit = Number(aiGlobalDailyLimitInput);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5 || !Number.isInteger(globalLimit) || globalLimit < 1 || globalLimit > 5000) throw new Error("Check the per-account and platform-wide AI limits.");
      const result = await requestJson("/api/admin/ai-drafting-settings", {
        method: "POST",
        body: JSON.stringify({ enabled, daily_limit: limit, global_daily_limit: globalLimit, reason: aiSettingsReason }),
      });
      setAiDraftingSettings((previous) => previous ? { ...previous, ai_drafting_enabled: result.enabled, ai_daily_generation_limit: result.daily_limit, ai_global_daily_generation_limit: result.global_daily_limit } : previous);
      setAiSettingsReason("");
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update AI drafting settings.");
    } finally {
      setBusy("");
    }
  };

  const saveAppEmailLimit = async (event: FormEvent) => {
    event.preventDefault();
    const limit = Number(appEmailLimitInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 75 || appEmailLimitReason.trim().length < 8) return;
    setBusy("app-email-limit");
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/admin/email-daily-limit", {
        method: "POST",
        body: JSON.stringify({ limit, reason: appEmailLimitReason }),
      });
      setAppEmailSettings((previous) => previous ? { ...previous, daily_limit: result.daily_limit } : previous);
      setAppEmailLimitInput(String(result.daily_limit));
      setAppEmailLimitReason("");
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the app email limit.");
    } finally {
      setBusy("");
    }
  };

  const saveAccountEmailLimits = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("account-email-limits"); setError(""); setNotice("");
    try {
      const result = await requestJson("/api/admin/account-email-limits", {
        method: "POST", body: JSON.stringify({ ...accountEmailInputs, reason: accountEmailReason }),
      });
      setAccountEmailLimits({ free_email_daily_limit: result.free_daily, free_email_monthly_limit: result.free_monthly, pro_email_daily_limit: result.pro_daily, pro_email_monthly_limit: result.pro_monthly });
      setAccountEmailReason("");
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update account email allowances.");
    } finally { setBusy(""); }
  };

  const saveEstimateTradeOptions = async (event: FormEvent) => {
    event.preventDefault();
    const options = parseEstimateTradeOptions(estimateTradeOptions);
    if (!options || estimateTradeOptionsReason.trim().length < 8) return;
    setBusy("estimate-trades");
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/admin/trades", {
        method: "POST",
        body: JSON.stringify({ trades: options, reason: estimateTradeOptionsReason }),
      });
      setEstimateTradeOptions(result.trades);
      setEstimateTradeOptionsReason("");
      setNotice(result.message || "Estimate trade options saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save estimate trade options.");
    } finally {
      setBusy("");
    }
  };

  const moveEstimateTradeOption = (index: number, direction: -1 | 1) => {
    setEstimateTradeOptions((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
      return reordered;
    });
  };

  if (accessState === "loading") return <LocalizedTree><main className="mx-auto max-w-6xl px-4 py-14"><p className="text-slate-600">Checking administrator access…</p></main></LocalizedTree>;
  if (accessState !== "ready") return <LocalizedTree><main className="mx-auto max-w-3xl px-4 py-14"><section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><h1 className="text-2xl font-bold text-slate-900">Admin support</h1><p className="mt-3 text-slate-600">{accessState === "denied" ? "This account does not have support-console access." : error}</p></section></main></LocalizedTree>;

  if (mfaRequired) return <LocalizedTree><main className="mx-auto max-w-2xl px-4 py-14"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Protected admin access</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Verify your identity</h1><p className="mt-2 text-sm leading-6 text-slate-600">WorkCraft AI requires an authenticator code before opening customer support or billing data.</p>{mfaError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{mfaError}</p>}{!mfaFactorId ? <button type="button" onClick={() => void beginMfaSetup()} disabled={mfaBusy} className="mt-5 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{mfaBusy ? "Starting setup…" : "Set up authenticator app"}</button> : <><div className="mt-5 rounded-xl bg-slate-50 p-4">{mfaQrCode && <div className="flex flex-col items-center gap-3"><Image unoptimized width={192} height={192} src={mfaQrCode} alt="QR code for WorkCraft AI admin authenticator" className="h-48 w-48 rounded-lg bg-white p-2" /><p className="text-sm font-semibold text-slate-800">Scan this QR code with an authenticator app.</p>{mfaSecret && <p className="break-all text-xs text-slate-600">Manual setup key: <code>{mfaSecret}</code></p>}</div>}{mfaVerifiedFactor && <p className="text-sm text-slate-700">Enter the current code from your authenticator app.</p>}</div><form onSubmit={verifyMfa} className="mt-4"><label htmlFor="admin-mfa-code" className="block text-sm font-semibold text-slate-800">6-digit authenticator code</label><input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 text-lg tracking-[0.3em]" /><button disabled={mfaBusy || mfaCode.length !== 6} className="mt-4 rounded-lg bg-orange-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{mfaBusy ? "Verifying…" : "Verify and open admin support"}</button></form></>}</section></main></LocalizedTree>;

  return (
    <LocalizedTree>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">WorkCraft AI internal</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Admin support</h1><p className="mt-2 text-slate-600">Look up an account, send password recovery, record support context, and review subscription status.</p></div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">{role?.replace("_", " ")}</span>
      </div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <div className="mb-6 border-b border-slate-200">
        <div role="tablist" aria-label={language === "es" ? "Secciones de soporte de administración" : "Admin support sections"} className="flex gap-2 overflow-x-auto pb-2">
          {adminTabs.map((tab) => (
            <button
              key={tab.id}
              id={`admin-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={tab.controls}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              className={`min-h-11 shrink-0 rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${activeTab === tab.id ? "border-b-2 border-orange-700 bg-orange-50 text-orange-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <section id="accounts-summary-panel" role="tabpanel" aria-labelledby="admin-tab-accounts" tabIndex={0} hidden={activeTab !== "accounts"} className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 sm:p-6">
        <h2 id="admin-account-totals" className="text-lg font-bold text-slate-900">{translate(language, "Account totals")}</h2>
        <p className="mt-1 text-sm text-slate-600">{translate(language, "Current Supabase Auth accounts, including test and admin accounts. Signed in means at least one recorded sign-in, not an active session.")}</p>
        {accountStatsError ? <p role="alert" className="mt-4 text-sm text-red-800">{accountStatsError}</p> : accountStats ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4"><dt className="text-sm font-medium text-slate-600">{translate(language, "Accounts created")}</dt><dd className="mt-2 text-3xl font-bold text-slate-950">{accountStats.created.toLocaleString()}</dd></div>
            <div className="rounded-xl bg-slate-50 p-4"><dt className="text-sm font-medium text-slate-600">{translate(language, "Email verified")}</dt><dd className="mt-2 text-3xl font-bold text-slate-950">{accountStats.email_verified.toLocaleString()}</dd></div>
            <div className="rounded-xl bg-slate-50 p-4"><dt className="text-sm font-medium text-slate-600">{translate(language, "Signed in at least once")}</dt><dd className="mt-2 text-3xl font-bold text-slate-950">{accountStats.signed_in.toLocaleString()}</dd></div>
          </dl>
        ) : <p role="status" className="mt-4 text-sm text-slate-600">{translate(language, "Loading account totals…")}</p>}
      </section>

      {role !== "support" && <section id="billing-panel" role="tabpanel" aria-labelledby="admin-tab-billing" tabIndex={0} hidden={activeTab !== "billing"} className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="recovery-heading" className="text-lg font-bold text-slate-900">{language === "es" ? "Recuperación de pagos de Pro" : "Pro payment recovery"}</h2><p className="mt-1 text-sm text-slate-600">{language === "es" ? "Solo suscripciones de WorkCraft AI. El acceso Pro continúa durante tres días hábiles después del primer fallo; Stripe puede seguir intentando el cobro después." : "WorkCraft AI subscriptions only. Pro access continues for three weekdays after the first failure; Stripe may continue retrying afterward."}</p></div><button type="button" onClick={() => void loadRecovery()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800">{language === "es" ? "Actualizar" : "Refresh"}</button></div>
        {recoveryError && <p role="alert" className="mt-3 text-sm text-red-800">{recoveryError}</p>}
        {recovery ? <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([
            ["past_due", language === "es" ? "Pagos vencidos" : "Past due"],
            ["in_grace", language === "es" ? "En plazo de gracia" : "In grace"],
            ["grace_ended", language === "es" ? "Plazo terminado" : "Grace ended"],
            ["retry_scheduled", language === "es" ? "Reintento previsto" : "Retry scheduled"],
            ["recovered_this_month", language === "es" ? "Recuperados este mes" : "Recovered this month"],
          ] as const).map(([key, label]) => <div key={key} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="mt-1 text-2xl font-bold text-slate-950">{recovery.counts[key]}</dd></div>)}</dl>
          <div className="mt-5 space-y-2"><h3 className="text-sm font-bold text-slate-900">{language === "es" ? "Facturas con fallos recientes" : "Recent invoices with failed payments"}</h3>{recovery.invoices.length === 0 ? <p className="text-sm text-slate-600">{language === "es" ? "No hay fallos registrados." : "No failed payments recorded."}</p> : recovery.invoices.map((item) => <div key={item.invoice_id} className="rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-700"><p className="font-semibold text-slate-900">{item.email} · {new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: item.currency.toUpperCase() }).format(item.amount_due / 100)} · {item.status}</p><p>{language === "es" ? "Intentos" : "Attempts"}: {item.attempt_count} · {language === "es" ? "Último fallo" : "Last failure"}: {date(item.last_failed_at)} · {language === "es" ? "Próximo intento" : "Next retry"}: {date(item.next_retry_at)}</p><a href={`https://dashboard.stripe.com/invoices/${encodeURIComponent(item.invoice_id)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-800 underline">{language === "es" ? "Ver factura en Stripe" : "View invoice in Stripe"}</a></div>)}</div>
        </> : !recoveryError && <p role="status" className="mt-3 text-sm text-slate-600">{language === "es" ? "Cargando…" : "Loading…"}</p>}
        <p className="mt-4 text-xs text-slate-600">{language === "es" ? "Stripe administra los avisos de tarjetas próximas a vencer y los reintentos. Consulta los detalles y los registros de correos en Stripe → Revenue recovery. Aquí no se guardan números completos de tarjeta." : "Stripe manages expiring-card emails and retry timing. Review card notices and email logs in Stripe → Revenue recovery. Full card numbers are never stored here."}</p>
      </section>}

      {role === "super_admin" && <div id="settings-panel" role="tabpanel" aria-labelledby="admin-tab-settings" tabIndex={0} hidden={activeTab !== "settings"} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600">
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div><h2 className="text-lg font-bold text-slate-900">Free-tier estimate limit</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Free accounts can save up to 10 estimates per UTC day and 50 per UTC month. Set a lower daily ceiling here for testing or cost control. Estimates already created today count; edits do not. Changing the limit below usage already reached takes effect on the next creation attempt.</p></div>
        <form onSubmit={saveFreeEstimateLimit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(8rem,12rem)_1fr_auto] sm:items-end">
          <label className="block text-xs font-semibold text-slate-700">Free estimates per day<input aria-label="Free estimates per UTC day" type="number" min={0} max={10} step={1} value={freeEstimateLimitInput} onChange={(event) => setFreeEstimateLimitInput(event.target.value)} disabled={freeEstimateLimitLoading} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
          <label className="block text-xs font-semibold text-slate-700">Reason for change<input value={freeEstimateLimitReason} onChange={(event) => setFreeEstimateLimitReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: adjust friends-and-family test allowance" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
          <button type="submit" disabled={busy !== "" || freeEstimateLimit === null || !freeEstimateLimitInput.trim() || !Number.isInteger(Number(freeEstimateLimitInput)) || Number(freeEstimateLimitInput) < 0 || Number(freeEstimateLimitInput) > 10 || freeEstimateLimitReason.trim().length < 8} className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "free-estimate-limit" ? "Saving…" : "Save limit"}</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Allowed daily range: 0–10. The monthly cap is fixed at 50. A daily limit of 0 pauses new free-tier estimate creation. Every change is written to the admin audit log.</p>
      </section>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div><h2 className="text-lg font-bold text-slate-900">Transactional email capacity</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Free account email allowances apply to estimate emails; trial and paid Pro share one allowance for estimate emails, follow-ups, customer-question alerts, and invoices. The separate app-wide cap is 75 per UTC day, with reserves of 20 Auth emails and 5 billing emails. The Auth reserve requires the Supabase Send Email hook; custom SMTP bypasses this app budget. Accepted or ambiguous provider requests count; definite rejections release their reservation.</p></div>
        {accountEmailLimits && <>
          <p className="mt-4 text-sm text-slate-700"><strong>Current per-account allowances:</strong> Free {accountEmailLimits.free_email_daily_limit}/day, {accountEmailLimits.free_email_monthly_limit}/month · Trial/Pro {accountEmailLimits.pro_email_daily_limit}/day, {accountEmailLimits.pro_email_monthly_limit}/month (UTC).</p>
          <form onSubmit={saveAccountEmailLimits} className="mt-4 grid gap-3 sm:grid-cols-4">
            {(["free_daily", "free_monthly", "pro_daily", "pro_monthly"] as const).map((field) => <label key={field} className="block text-xs font-semibold text-slate-700">{({ free_daily: "Free per day", free_monthly: "Free per month", pro_daily: "Trial/Pro per day", pro_monthly: "Trial/Pro per month" })[field]}<input type="number" inputMode="numeric" step={1} min={field.startsWith("free") ? 0 : 1} max={field === "free_daily" ? 10 : field === "free_monthly" ? 100 : field === "pro_daily" ? 50 : 1000} value={accountEmailInputs[field]} onChange={(event) => setAccountEmailInputs((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>)}
            <label className="block text-xs font-semibold text-slate-700 sm:col-span-3">Reason for change<input value={accountEmailReason} onChange={(event) => setAccountEmailReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: adjust pilot email allowances" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <button type="submit" disabled={busy !== "" || accountEmailReason.trim().length < 8} className="self-end rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "account-email-limits" ? "Saving…" : "Save plan allowances"}</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Free 0/day and 0/month disables app-sent estimate email. Monthly must be at least daily. Each change applies immediately to all accounts and is recorded in the admin audit log. The app-wide cap remains independent.</p>
        </>}
        {appEmailSettings && <>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p><strong>Current cap:</strong> {appEmailSettings.daily_limit} / day</p><p className="mt-1"><strong>Today:</strong> {appEmailSettings.today.emails_started} app email reservations used (UTC)</p></div>
          <form onSubmit={saveAppEmailLimit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(8rem,12rem)_1fr_auto] sm:items-end">
            <label className="block text-xs font-semibold text-slate-700">App emails per day<input aria-label="App emails per UTC day" type="number" min={1} max={75} step={1} value={appEmailLimitInput} onChange={(event) => setAppEmailLimitInput(event.target.value)} disabled={appEmailSettingsLoading} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <label className="block text-xs font-semibold text-slate-700">Reason for change<input value={appEmailLimitReason} onChange={(event) => setAppEmailLimitReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: reduce email volume during testing" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <button type="submit" disabled={busy !== "" || appEmailSettingsLoading || !appEmailSettings || !Number.isInteger(Number(appEmailLimitInput)) || Number(appEmailLimitInput) < 1 || Number(appEmailLimitInput) > 75 || appEmailLimitReason.trim().length < 8} className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "app-email-limit" ? "Saving…" : "Save email limit"}</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Allowed range: 1–75 app emails per UTC day. Changes are recorded in the admin audit log. If the limit is reached, email sending pauses until 00:00 UTC; estimate data and saved support questions remain available.</p>
        </>}
        {appEmailSettingsLoading && !appEmailSettings && <p className="mt-3 text-sm text-slate-500">Loading email capacity…</p>}
      </section>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div><h2 className="text-lg font-bold text-slate-900">Estimate trade options</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Manage the choices shown in the Trade dropdown when creating an estimate. Add an English name and its Spanish label for each trade. Use the up and down buttons to change their order, then save. Changes apply to new estimate forms; existing estimates keep their saved trade.</p></div>
        <form onSubmit={saveEstimateTradeOptions} className="mt-4 space-y-3">
          <div className="space-y-3">
            {estimateTradeOptions.map((option, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block text-xs font-semibold text-slate-700">Trade name (English)<input required maxLength={60} value={option.value} onChange={(event) => setEstimateTradeOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-700">Trade name (Spanish)<input required maxLength={60} value={option.label_es} onChange={(event) => setEstimateTradeOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label_es: event.target.value } : item))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal" /></label>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" aria-label={`${translate(language, "Move up")}: ${option.value || translate(language, "Unnamed trade")}`} title={`${translate(language, "Move up")}: ${option.value || translate(language, "Unnamed trade")}`} onClick={() => moveEstimateTradeOption(index, -1)} disabled={index === 0 || busy !== "" || estimateTradeOptionsLoading} className="min-h-12 min-w-12 rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-bold text-slate-800 disabled:opacity-40">↑</button>
                <button type="button" aria-label={`${translate(language, "Move down")}: ${option.value || translate(language, "Unnamed trade")}`} title={`${translate(language, "Move down")}: ${option.value || translate(language, "Unnamed trade")}`} onClick={() => moveEstimateTradeOption(index, 1)} disabled={index === estimateTradeOptions.length - 1 || busy !== "" || estimateTradeOptionsLoading} className="min-h-12 min-w-12 rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-bold text-slate-800 disabled:opacity-40">↓</button>
                <button type="button" aria-label={translate(language, "Remove this trade")} title={translate(language, "Remove this trade")} onClick={() => setEstimateTradeOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={estimateTradeOptions.length <= 1 || busy !== ""} className="min-h-12 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-40">{translate(language, "Remove")}</button>
              </div>
            </div>)}
          </div>
          <button type="button" onClick={() => setEstimateTradeOptions((current) => [...current, { value: "", label_es: "" }])} disabled={estimateTradeOptionsLoading || estimateTradeOptions.length >= 40 || busy !== ""} className="min-h-12 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50">+ {translate(language, "Add trade")}</button>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-xs font-semibold text-slate-700">Reason for change<input value={estimateTradeOptionsReason} onChange={(event) => setEstimateTradeOptionsReason(event.target.value)} minLength={8} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <button type="submit" disabled={busy !== "" || estimateTradeOptionsLoading || !parseEstimateTradeOptions(estimateTradeOptions) || estimateTradeOptionsReason.trim().length < 8} className="min-h-12 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "estimate-trades" ? "Saving…" : "Save trade options"}</button>
          </div>
          <p className="text-xs text-slate-500">Keep each name unique. Custom trade names need both labels; every change is recorded in the admin audit log.</p>
          {estimateTradeOptionsLoading && <p className="text-sm text-slate-500">Loading estimate trade options…</p>}
        </form>
      </section>
      </div>}

      {role === "super_admin" && <div id="ai-panel" role="tabpanel" aria-labelledby="admin-tab-ai" tabIndex={0} hidden={activeTab !== "ai"} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600">
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div><h2 className="text-lg font-bold text-slate-900">Cloud AI drafting cost controls</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Pro includes up to 5 cloud drafting attempts per account per UTC day and 50 per UTC month. The daily account limit can be lowered here; the monthly cap remains 50. The platform-wide ceiling remains 250 attempts across all accounts per UTC day. A valid attempt counts when admitted for provider processing, including provider failures. We record counts, model, prompt length, outcome, and response status; prompts and generated content are not stored in the usage log. Records older than 90 days are pruned when drafting requests run. Usage data is private and available only to authorized administrators.</p></div>
        {aiDraftingSettings && <>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p><strong>Status:</strong> {aiDraftingSettings.ai_drafting_enabled ? "Enabled" : "Paused"} · <strong>Per account:</strong> {aiDraftingSettings.ai_daily_generation_limit} / day, {aiDraftingSettings.ai_monthly_generation_limit} / month · <strong>Platform:</strong> {aiDraftingSettings.ai_global_daily_generation_limit} / day</p><p className="mt-1"><strong>Today:</strong> {aiDraftingSettings.today.attempts_started} attempted ({aiDraftingSettings.today.succeeded} succeeded, {aiDraftingSettings.today.failed} failed) · {aiDraftingSettings.today.global_attempts_started} of {aiDraftingSettings.ai_global_daily_generation_limit} platform attempts used</p><p className="mt-1"><strong>This month, all accounts:</strong> {aiDraftingSettings.this_month.attempts_started} attempts</p></div>
          <form onSubmit={saveAiDraftingSettings} className="mt-4 grid gap-3 sm:grid-cols-[minmax(8rem,12rem)_minmax(8rem,12rem)_1fr_auto] sm:items-end">
            <label className="block text-xs font-semibold text-slate-700">Draft attempts per day<input aria-label="AI drafting attempts per UTC day" type="number" min={1} max={5} step={1} value={aiDailyLimitInput} onChange={(event) => setAiDailyLimitInput(event.target.value)} disabled={aiSettingsLoading} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <label className="block text-xs font-semibold text-slate-700">Platform attempts per day<input aria-label="Platform AI drafting attempts per UTC day" type="number" min={1} max={5000} step={1} value={aiGlobalDailyLimitInput} onChange={(event) => setAiGlobalDailyLimitInput(event.target.value)} disabled={aiSettingsLoading} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <label className="block text-xs font-semibold text-slate-700">Reason for change<input value={aiSettingsReason} onChange={(event) => setAiSettingsReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: reduce provider spend during testing" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
            <button type="submit" disabled={busy !== "" || aiSettingsLoading || !aiDraftingSettings || !Number.isInteger(Number(aiDailyLimitInput)) || Number(aiDailyLimitInput) < 1 || Number(aiDailyLimitInput) > 5 || !Number.isInteger(Number(aiGlobalDailyLimitInput)) || Number(aiGlobalDailyLimitInput) < 1 || Number(aiGlobalDailyLimitInput) > 5000 || aiSettingsReason.trim().length < 8} className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "ai-drafting-settings" ? "Saving…" : "Save AI limits"}</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => void setAiDraftingEnabled(false)} disabled={busy !== "" || aiSettingsLoading || !aiDraftingSettings.ai_drafting_enabled || aiSettingsReason.trim().length < 8} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Pause cloud drafting</button><button type="button" onClick={() => void setAiDraftingEnabled(true)} disabled={busy !== "" || aiSettingsLoading || aiDraftingSettings.ai_drafting_enabled || aiSettingsReason.trim().length < 8} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50">Resume cloud drafting</button></div>
          <p className="mt-2 text-xs text-slate-500">Allowed ranges: 1–5 attempts per account and 1–5,000 platform attempts per UTC day. Changes and pause/resume actions are recorded in the admin audit log. Failed provider calls count toward both limits.</p>
        </>}
        {aiSettingsLoading && !aiDraftingSettings && <p className="mt-3 text-sm text-slate-500">Loading AI drafting settings…</p>}
      </section>

        <AiMatchMetricsPanel language={language} active={activeTab === "ai"} />
      </div>}

      <div id="cron-panel" role="tabpanel" aria-labelledby="admin-tab-cron" tabIndex={0} hidden={activeTab !== "cron"} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600">
        <CronJobsPanel language={language} />
      </div>

      <div id="accounts-records-panel" role="tabpanel" aria-labelledby="admin-tab-accounts" tabIndex={0} hidden={activeTab !== "accounts"} className="space-y-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">{translate(language, "Find a customer account")}</h2>
        <form onSubmit={searchAccounts} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="account-search">Email or business name</label>
          <input id="account-search" value={search} onChange={(event) => setSearch(event.target.value)} minLength={3} maxLength={120} placeholder="Search by email or business name" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100" />
          <button disabled={searching || search.trim().length < 3} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{searching ? "Searching…" : "Search accounts"}</button>
        </form>
        {accounts.length > 0 && <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">{accounts.map((account) => <button key={account.id} type="button" onClick={() => void loadDetail(account.id)} className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-orange-50 sm:flex-row sm:items-center sm:justify-between ${selectedId === account.id ? "bg-orange-50" : ""}`}><span><span className="block font-semibold text-slate-900">{account.email}</span><span className="text-xs text-slate-500">{account.business_name || "No business name"} · Joined {date(account.created_at)}</span></span><span className="text-xs font-bold uppercase text-slate-600">{account.plan_status}</span></button>)}</div>}
      </section>

      {detail && role !== "support" && <section className="mt-6 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm sm:p-6">
        <div><p className="text-xs font-bold uppercase tracking-wide text-orange-800">Pro access management</p><h2 className="mt-1 text-lg font-bold text-slate-950">{detail.account.email}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Grant Pro for product testing, feedback, or customer support. This is separate from Stripe billing. Pro includes cloud AI subject to the existing daily caps, and the grant is recorded in the admin audit log.</p></div>
        {detail.account.active_pro_grant ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-950">{detail.account.active_pro_grant.grant_type === "permanent" ? "Active permanent admin grant" : "Active temporary admin grant"}</p><p className="mt-1 text-sm text-emerald-900">{detail.account.active_pro_grant.grant_type === "permanent" ? "No automatic expiration; it stays active until an admin revokes it." : <>{"Expires"} {date(detail.account.active_pro_grant.expires_at)}.</>}</p><p className="mt-1 text-xs text-emerald-900"><span>Reason:</span> {detail.account.active_pro_grant.reason}</p><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-semibold text-slate-700">Reason for revocation<input value={proAccessReason} onChange={(event) => setProAccessReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: beta feedback period ended" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><button type="button" onClick={revokeProAccess} disabled={busy !== "" || proAccessReason.trim().length < 8} className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-50">{busy === "pro-access" ? "Saving…" : "Revoke Pro access"}</button></div></div> : <form onSubmit={saveProAccess} className="mt-4 grid gap-3 sm:grid-cols-[minmax(9rem,13rem)_minmax(8rem,10rem)_1fr_auto] sm:items-end">
          <label className="block text-xs font-semibold text-slate-700">Grant type<select value={proGrantType} onChange={(event) => setProGrantType(event.target.value as "temporary" | "permanent")} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"><option value="temporary">Temporary</option><option value="permanent">Permanent until revoked</option></select></label>
          {proGrantType === "temporary" ? <label className="block text-xs font-semibold text-slate-700">Duration (days)<input type="number" min={1} max={365} step={1} value={proGrantDurationDays} onChange={(event) => setProGrantDurationDays(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label> : <p className="pb-2 text-xs text-slate-500">Remains active until manually revoked.</p>}
          <label className="block text-xs font-semibold text-slate-700">Reason<input value={proAccessReason} onChange={(event) => setProAccessReason(event.target.value)} minLength={8} maxLength={500} placeholder="For example: 30-day customer feedback program" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label>
          <button type="submit" disabled={busy !== "" || proAccessReason.trim().length < 8 || (proGrantType === "temporary" && (!Number.isInteger(Number(proGrantDurationDays)) || Number(proGrantDurationDays) < 1 || Number(proGrantDurationDays) > 365))} className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "pro-access" ? "Saving…" : "Grant Pro access"}</button>
        </form>}
        {detail.pro_grants.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Grant history</h3><ul className="mt-2 space-y-2">{detail.pro_grants.map((grant) => <li key={grant.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span>{grant.grant_type === "permanent" ? "Permanent" : "Temporary"} · {grant.revoked_at ? `revoked ${date(grant.revoked_at)}` : grant.is_expired ? `expired ${date(grant.expires_at)}` : grant.expires_at ? `expires ${date(grant.expires_at)}` : "active until revoked"}</span><span>{grant.reason}</span></li>)}</ul></div>}
      </section>}

      {detail && <div className="grid items-start gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Account</p><h2 className="mt-1 break-all text-xl font-bold text-slate-950">{detail.account.email}</h2><p className="mt-1 text-sm text-slate-600">{detail.account.business_name || "No business name on file"}</p></div>
          <dl className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Email confirmed</dt><dd className="mt-1 font-semibold text-slate-900">{detail.account.email_confirmed_at ? "Yes" : "No"}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Plan status</dt><dd className="mt-1 font-semibold capitalize text-slate-900">{adminPlanStatus(detail.account)}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Joined</dt><dd className="mt-1 font-medium text-slate-900">{date(detail.account.created_at)}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Last sign in</dt><dd className="mt-1 font-medium text-slate-900">{date(detail.account.last_sign_in_at)}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Last app activity</dt><dd className="mt-1 font-medium text-slate-900">{date(detail.account.last_active_at)}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Retention status</dt><dd className="mt-1 font-semibold capitalize text-slate-900">{detail.account.deletion_status.replaceAll("_", " ")}</dd></div><div className="col-span-2 rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Current billing period ends</dt><dd className="mt-1 font-medium text-slate-900">{date(detail.account.current_period_end)}</dd></div></dl>

          {role === "super_admin" && <form onSubmit={(event) => { event.preventDefault(); resetAccountAiUsage(); }} className="rounded-xl border border-purple-200 bg-purple-50 p-4">
            <h3 className="font-bold text-purple-950">Reset account AI allowance</h3>
            {detail.ai_usage ? <p className="mt-1 text-sm text-purple-900"><strong>Today (UTC):</strong> {detail.ai_usage.daily_used} / {detail.ai_usage.daily_limit} {translate(language, "used")} · <strong>This month (UTC):</strong> {detail.ai_usage.monthly_used} / {detail.ai_usage.monthly_limit} {translate(language, "used")}</p> : <p className="mt-1 text-sm text-purple-900">AI usage counts are unavailable.</p>}
            <p className="mt-2 text-xs leading-5 text-purple-900">Resets this account’s current daily and monthly AI counts. The event history, provider token totals, and shared platform-wide daily limit stay unchanged. An active AI request must finish first. Every reset is audited.</p>
            <label className="mt-3 block text-xs font-semibold text-purple-950">Reason for reset<input value={aiUsageResetReason} onChange={(event) => setAiUsageResetReason(event.target.value)} minLength={8} maxLength={500} className="mt-1 w-full rounded-lg border border-purple-300 bg-white px-3 py-2.5 text-sm font-normal" /></label>
            <button type="submit" disabled={busy !== "" || aiUsageResetReason.trim().length < 8} className="mt-3 min-h-12 rounded-lg bg-purple-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "ai-usage-reset" ? "Resetting…" : "Reset AI counts"}</button>
          </form>}

          {detail.account.deletion_status === "pending_deletion" && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Inactivity deletion is pending</h3><p className="mt-1 text-sm leading-5 text-amber-900">Warning sent {date(detail.account.deletion_notice_sent_at)} · deletion due {date(detail.account.deletion_due_at)}. The user signing in cancels it automatically.</p>{role === "super_admin" && <form onSubmit={cancelPendingDeletion} className="mt-3"><label className="block text-xs font-semibold text-amber-950">Reason to cancel<input value={retentionReason} onChange={(event) => setRetentionReason(event.target.value)} minLength={8} maxLength={500} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm font-normal" /></label><button type="submit" disabled={busy !== "" || retentionReason.trim().length < 8} className="mt-3 rounded-lg border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50">{busy === "retention" ? "Saving…" : "Cancel pending deletion"}</button></form>}</section>}
          {detail.account.deletion_status === "deleting" && <p role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">An account deletion is currently being processed.</p>}

          <div className="border-t border-slate-100 pt-4"><h3 className="font-bold text-slate-900">Password assistance</h3><p className="mt-1 text-xs leading-5 text-slate-600">Sends a Supabase recovery email. You cannot view or set the customer’s existing password.</p><label className="mt-3 block text-xs font-semibold text-slate-700">Reason for support action<input value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} maxLength={500} placeholder="For example: customer requested account access help" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><button type="button" onClick={sendRecovery} disabled={busy !== "" || recoveryReason.trim().length < 8} className="mt-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "recovery" ? "Sending…" : "Send password recovery email"}</button></div>

          {role !== "support" && <form onSubmit={applyCoupon} className="border-t border-slate-100 pt-4"><h3 className="font-bold text-slate-900">Temporary subscription discount</h3><p className="mt-1 text-xs leading-5 text-slate-600">Apply an existing Stripe 100% off coupon lasting once or up to 3 months. Create the coupon in Stripe first.</p><label className="mt-3 block text-xs font-semibold text-slate-700">Stripe coupon ID<input value={couponId} onChange={(event) => setCouponId(event.target.value)} maxLength={120} placeholder="e.g. support_one_month" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><label className="mt-3 block text-xs font-semibold text-slate-700">Reason<input value={billingReason} onChange={(event) => setBillingReason(event.target.value)} maxLength={500} placeholder="Service issue and agreed credit" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><button type="submit" disabled={busy !== "" || couponId.trim().length < 3 || billingReason.trim().length < 8 || !detail.account.has_stripe_subscription || !["active", "trialing"].includes(detail.account.status)} className="mt-3 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "billing" ? "Applying…" : "Apply Stripe coupon"}</button><p className="mt-2 text-xs text-slate-500">Billing action is recorded in the admin audit log.</p></form>}

          <form onSubmit={saveNote} className="border-t border-slate-100 pt-4"><h3 className="font-bold text-slate-900">Internal support note</h3><label className="mt-3 block text-xs font-semibold text-slate-700">Issue type<select value={noteCategory} onChange={(event) => setNoteCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"><option value="support">General support</option><option value="bug_report">Bug report</option><option value="billing">Billing issue</option><option value="email_delivery">Email delivery issue</option></select></label><label className="mt-3 block text-xs font-semibold text-slate-700">Note<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={5000} placeholder="Record relevant support context. Avoid passwords or payment-card data." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><label className="mt-3 block text-xs font-semibold text-slate-700">Reason for adding note<input value={noteReason} onChange={(event) => setNoteReason(event.target.value)} maxLength={500} placeholder="Why this note is needed" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" /></label><button disabled={busy !== "" || !note.trim() || noteReason.trim().length < 8} className="mt-3 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50">{busy === "note" ? "Saving…" : "Save support note"}</button></form>

          {role === "super_admin" && <form onSubmit={deleteSelectedAccount} className="border-t border-red-200 pt-5">{detail.account.is_admin ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><h3 className="font-bold text-slate-800">Administrator account protected</h3><p className="mt-1 text-sm text-slate-600">Admin accounts cannot be deleted through this console.</p></div> : <div className="rounded-xl border border-red-300 bg-red-50 p-4"><h3 className="font-bold text-red-950">Delete this account</h3><p className="mt-1 text-sm leading-5 text-red-900">Permanently removes the WorkCraft AI account, its estimates, customer and job data, uploaded estimate media, and payment records. Any WorkCraft AI subscription is canceled first. The contractor’s separate Stripe account is not deleted. This cannot be undone.</p><label className="mt-3 block text-xs font-semibold text-red-950">Reason for deletion<textarea value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} rows={2} minLength={8} maxLength={500} className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2.5 text-sm font-normal" /></label><label className="mt-3 block text-xs font-semibold text-red-950">Type the account email to confirm<input value={deletionConfirmEmail} onChange={(event) => setDeletionConfirmEmail(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2.5 text-sm font-normal" /></label><button type="submit" disabled={busy !== "" || deletionConfirmEmail.trim().toLowerCase() !== detail.account.email.toLowerCase() || deletionReason.trim().length < 8 || detail.account.deletion_status === "deleting"} className="mt-3 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "account-deletion" ? "Deleting account…" : "Delete account permanently"}</button><p className="mt-2 text-xs text-red-900">Every deletion is audited. Multi-factor authentication is required.</p></div>}</form>}
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">Support history</h2><h3 className="mt-4 text-sm font-bold text-slate-700">Customer proposal questions</h3>{detail.questions.length ? <ol className="mt-2 space-y-2">{detail.questions.map((question) => <li key={question.id} className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">{question.customer_name} · {question.customer_email} · {date(question.created_at)}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{question.message}</p></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No customer questions on record.</p>}<h3 className="mt-5 text-sm font-bold text-slate-700">Estimate email activity</h3>{detail.email_events.length ? <ol className="mt-2 space-y-2">{detail.email_events.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-semibold text-slate-700">{item.event.replaceAll("_", " ")} · {item.recipient || "No recipient recorded"}</span><span className="text-slate-500">{date(item.created_at)}</span></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No estimate email events on record.</p>}<h3 className="mt-5 text-sm font-bold text-slate-700">Internal notes and issue reports</h3>{detail.notes.length ? <ol className="mt-2 space-y-3">{detail.notes.map((entry) => <li key={entry.id} className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-orange-800">{entry.category.replaceAll("_", " ")}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{entry.note}</p><p className="mt-2 text-xs text-slate-500">{date(entry.created_at)} · {entry.actor_email || "Admin"}</p></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No internal notes yet.</p>}</div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">Admin audit log</h2>{detail.audit.length ? <ol className="mt-4 space-y-3">{detail.audit.map((entry) => <li key={entry.id} className="rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{entry.action.replaceAll("_", " ")}</p><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">{entry.outcome}</span></div><p className="mt-1 text-sm text-slate-600">{entry.reason}</p><p className="mt-2 text-xs text-slate-500">{date(entry.created_at)} · {entry.actor_email || "Admin"}</p></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">No admin actions recorded.</p>}</div>
        </section>
      </div>}
      </div>
    </main>
    </LocalizedTree>
  );
}
