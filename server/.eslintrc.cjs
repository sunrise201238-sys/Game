module.exports = {
  root: true,
  env: {
    node: true,
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
        project: "./tsconfig.json"
      }
    }
  },
  rules: {
    "import/no-unresolved": ["error", { ignore: ["^@shared/"] }]
  }
};
