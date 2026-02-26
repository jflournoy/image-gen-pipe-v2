import js from '@eslint/js';

export default [
  {
    ignores: [
      '.history/**',
      'test-ensemble-debug.js',
      'test-multi-image-ranking.js',
      'node_modules/**',
      'output/**',
      'session-history/**',
      'archive/**',
      '.venv/**'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_', 'caughtErrorsIgnorePattern': '^_' }],
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single']
    }
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/templates/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        localStorage: 'readonly'
      }
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        WebSocket: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        AbortController: 'readonly',
        TextDecoder: 'readonly',
        Image: 'readonly',
        FileReader: 'readonly',
        URL: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Date: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^(_|loadJob|confirmClearHistory|showProviderSettings|setFluxModelPath|clearFluxModelPath|displayModelSource|resetFluxModelToEnvDefault|resetFluxLoraSettingsComplete|editConfigValueAsText|restartAllServicesAndDismiss|resetConfigToDefaults|updateModelSourceAndRefresh|saveHfToken|showAdvancedConfig|updateRankingMode|restartServiceInModal|applyQuickLocalSettings|applyProviderSettings|downloadModel|startService|stopService|switchToLocalProviders|updateLLMProviderSettings|updateVisionProviderSettings|startServiceInline|stopServiceInline|restartServiceInline|saveBFLSettings|saveFaceFixingSettings|selectMode|visibleServices|addFluxLora|removeFluxLora|updateFluxLora|updateModalModelDefaults|DEFAULT_CLIP_ENCODER_PATH|DEFAULT_T5_ENCODER_PATH|DEFAULT_VAE_PATH|failed|updateChromaModelSource|toggleImageComparison|currentVideoImageId|videoGenerating|currentResampleImageId)$',
        'caughtErrorsIgnorePattern': '^_'
      }]
    }
  },
  {
    files: ['src/api/beam-search-worker.js'],
    languageOptions: {
      globals: {
        AbortController: 'readonly'
      }
    }
  }
];