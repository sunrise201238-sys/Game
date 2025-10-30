module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true
  },
  extends: ["eslint:recommended", "plugin:import/recommended", "prettier"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  settings: {
    "import/resolver": {
      typescript: {
        project: ["./tsconfig.json"]
      }
    }
  },
  rules: {
    "import/no-unresolved": ["error", { ignore: ["^@shared/"] }],
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "node:crypto", message: "Use portable shared hash helpers instead." },
          { name: "crypto", message: "Use portable shared hash helpers instead." }
        ]
      }
    ]
  }
};
