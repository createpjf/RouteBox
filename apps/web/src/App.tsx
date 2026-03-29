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
import { Billing } from "@/routes/Billing";
import { Keys } from "@/routes/Keys";
import { ApiDocs } from "@/routes/ApiDocs";

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
          <Route path="api" element={<ApiDocs />} />
          <Route path="billing" element={<Billing />} />
          <Route path="usage" element={<Usage />} />
          <Route path="keys" element={<Keys />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
