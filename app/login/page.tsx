"use client";

import { useSyncExternalStore } from "react";
import LoginForm from "./LoginForm";

const subscribeToMount = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export default function LoginPage() {
  const mounted = useSyncExternalStore(subscribeToMount, getClientMounted, getServerMounted);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
        <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
          <div className="h-10 w-10" />
          <div className="mt-6 h-8 w-64" />
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 py-8 px-4 shadow border border-slate-800 sm:rounded-xl sm:px-10">
            <div className="h-64" />
          </div>
        </div>
      </div>
    );
  }

  return <LoginForm />;
}