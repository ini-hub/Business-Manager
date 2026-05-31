import { createRoot } from "react-dom/client";
import { z } from "zod";
import App from "./App";
import "./index.css";

// Global fetch interceptor to automatically attach CSRF double-submit token
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);

  if (!isSafe) {
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const parts = c.trim().split("=");
      if (parts.length >= 2) {
        acc[parts[0]] = parts.slice(1).join("=");
      }
      return acc;
    }, {} as Record<string, string>);

    const csrfToken = cookies["_csrf"];
    if (csrfToken) {
      if (input instanceof Request) {
        input.headers.set("x-csrf-token", csrfToken);
      } else {
        init = init || {};
        const headers = new Headers(init.headers);
        headers.set("x-csrf-token", csrfToken);
        init.headers = headers;
      }
    }
  }

  return originalFetch(input, init);
};

const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type && issue.expected === "integer" && issue.received === "float") {
    return { message: "Whole numbers only...decimals are not allowed." };
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(customErrorMap);

// Prevent wheel scroll from changing numeric input values globally
document.addEventListener("wheel", () => {
  if (
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.type === "number"
  ) {
    document.activeElement.blur();
  }
}, { passive: true });

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for offline app-shell caching
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  } else {
    // Automatically clean up service workers in development to prevent caching issues
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((success) => {
          if (success) {
            console.log("Unregistered service worker successfully in development mode.");
            window.location.reload();
          }
        });
      }
    });
  }
}
