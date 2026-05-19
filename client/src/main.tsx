import { createRoot } from "react-dom/client";
import { z } from "zod";
import App from "./App";
import "./index.css";

const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type && issue.expected === "integer" && issue.received === "float") {
    return { message: "Whole numbers only...decimals are not allowed." };
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(customErrorMap);

createRoot(document.getElementById("root")!).render(<App />);
