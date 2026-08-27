import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist', 'node_modules', 'src/generated'],
  },
  {
    // Everything in this repo runs in Node - the server and the scripts beside
    // it - so process, console, fetch and the timers are all defined.
    // typescript-eslint turns no-undef off for .ts because the type checker
    // already knows what exists; a plain .mjs script gets no such treatment.
    languageOptions: {
      globals: globals.node,
    },
  }
);
