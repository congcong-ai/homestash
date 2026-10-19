import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["**/.next/**", "**/node_modules/**", "**/next-env.d.ts", "firmware/**", "vendor/**"] },
  ...ts.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
);
