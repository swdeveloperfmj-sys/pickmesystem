import { useEffect, useState } from "react";
import { api } from "./api";

export default function usePendingApprovals(user) {
  const [count, setCount] = useState(0);
  const enabled = user.sidebarAccess.includes("APPROVALS");
  useEffect(() => {
    setCount(0);
    if (!enabled) return;
    let disposed = false;
    let timer;
    let inFlight = false;
    async function refresh() {
      if (disposed || inFlight || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        const data = await api("/transport/approvals/pending-count");
        if (!disposed) setCount(data.count);
      } catch (error) {
        if (!disposed && [401, 403].includes(error.status)) setCount(0);
      } finally {
        inFlight = false;
        if (!disposed) timer = setTimeout(refresh, 10000);
      }
    }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("transport-request-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("transport-request-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user.id, enabled]);
  return enabled ? count : 0;
}
