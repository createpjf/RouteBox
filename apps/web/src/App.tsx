import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { Login } from "@/routes/Login";
import { Register } from "@/routes/Register";
import { ForgotPassword } from "@/routes/ForgotPassword";
import { Dashboard } from "@/routes/Dashboard";
import { Usage } from "@/routes/Usage";
import { Account } from "@/routes/Account";
import { Billing } from "@/routes/Billing";
import { ApiDocs } from "@/routes/ApiDocs";
import { Marketplace } from "@/routes/Marketplace";
import { MyListings } from "@/routes/MyListings";

export function App() {
  const { toasts, dismissToast } = useToast();

  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* Protected routes */}
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="usage" element={<Usage />} />
          <Route path="billing" element={<Billing />} />
          <Route path="account" element={<Account />} />
          <Route path="api-docs" element={<ApiDocs />} />
          <Route path="marketplace" element={<Marketplace />} />
          <Route path="my-listings" element={<MyListings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
