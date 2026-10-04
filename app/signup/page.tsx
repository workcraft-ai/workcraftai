"use client";

import { useSyncExternalStore } from "react";
import SignupForm from "./SignupForm";

const subscribeToMount = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export default function SignupPage() {
  const mounted = useSyncExternalStore(subscribeToMount, getClientMounted, getServerMounted);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="h-9 w-64 mx-auto" />
          <div className="mt-2 h-5 w-80 max-w-full mx-auto" />
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 py-8 px-4 shadow-xl border border-slate-800 sm:rounded-xl sm:px-10">
            <div className="h-80" />
          </div>
        </div>
      </div>
    );
  }

  return <SignupForm />;
}