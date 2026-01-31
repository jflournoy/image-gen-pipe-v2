/**
 * @file .env File Management Utility
 * Provides functions to read, write, and manage .env configuration files
 * while preserving comments, formatting, and structure.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Regex pattern for KEY=VALUE lines
const KEY_VALUE_REGEX = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/;

/**
 * Read and parse .env file into a JavaScript object
 * @param {string} filePath - Path to .env file (relative to project root)
 * @returns {Promise<Object>} Parsed configuration object
 */
export async function readEnvFile(filePath = '.env') {
  const fullPath = path.resolve(projectRoot, filePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const config = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(KEY_VALUE_REGEX);
      if (match) {
        const [, key, rawValue] = match;
        // Remove quotes if present
        let value = rawValue.trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith('\'') && value.endsWith('\''))) {
          value = value.slice(1, -1);
        }
        // Remove inline comments (everything after # outside quotes)
        const commentIndex = value.indexOf('#');
        if (commentIndex !== -1) {
          value = value.substring(0, commentIndex).trim();
        }
        config[key] = value;
      }
    }

    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${fullPath}`);
    }
    throw error;
  }
}

/**
 * Update specific values in .env file while preserving formatting
 * Uses atomic write strategy (temp file → verify → rename)
 * @param {Object} updates - Key-value pairs to update
 * @param {string} filePath - Path to .env file (relative to project root)
 * @returns {Promise<Object>} Result with success status and updated keys
 */
export async function updateEnvFile(updates, filePath = '.env') {
  const fullPath = path.resolve(projectRoot, filePath);
  const tempPath = `${fullPath}.tmp`;

  try {
    // Read existing content
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    const updatedKeys = new Set();
    const keysToUpdate = new Set(Object.keys(updates));

    // Process each line
    const updatedLines = lines.map(line => {
      const match = line.match(KEY_VALUE_REGEX);
      if (match) {
        const [, key] = match;
        if (keysToUpdate.has(key)) {
          updatedKeys.add(key);
          keysToUpdate.delete(key);
          // Preserve format: KEY=value
          const newValue = updates[key];
          // Quote value if it contains spaces or special characters
          const quotedValue = needsQuotes(newValue) ? `"${newValue}"` : newValue;
          return `${key}=${quotedValue}`;
        }
      }
      return line;
    });

    // Add any new keys that weren't found in the file
    if (keysToUpdate.size > 0) {
      // Add a separator if file doesn't end with newline
      if (updatedLines[updatedLines.length - 1] !== '') {
        updatedLines.push('');
      }

      updatedLines.push('# Added by configuration manager');
      for (const key of keysToUpdate) {
        const value = updates[key];
        const quotedValue = needsQuotes(value) ? `"${value}"` : value;
        updatedLines.push(`${key}=${quotedValue}`);
        updatedKeys.add(key);
      }
    }

    // Write to temp file
    const updatedContent = updatedLines.join('\n');
    await fs.writeFile(tempPath, updatedContent, 'utf-8');

    // Verify temp file is readable
    await fs.readFile(tempPath, 'utf-8');

    // Atomic rename
    await fs.rename(tempPath, fullPath);

    return {
      success: true,
      updated: Array.from(updatedKeys)
    };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Determine if a value needs to be quoted
 * @param {string} value - Value to check
 * @returns {boolean} True if value should be quoted
 */
function needsQuotes(value) {
  if (!value) return false;
  // Quote if contains spaces, quotes, or special characters
  return /[\s"'#$]/.test(value);
}

/**
 * Get context-aware configuration (filter by provider mode)
 * @param {Object} config - Full configuration object
 * @param {string} mode - Provider mode: 'local' or 'openai'
 * @returns {Object} Filtered configuration
 */
export function getRelevantConfig(config, mode) {
  const localKeys = [
    // Flux configuration
    'FLUX_MODEL_PATH',
    'FLUX_MODEL_SOURCE',
    'FLUX_LORA_PATH',
    'FLUX_LORA_SCALE',
    'FLUX_TEXT_ENCODER_PATH',
    'FLUX_TEXT_ENCODER_2_PATH',
    'FLUX_VAE_PATH',

    // LLM configuration
    'LLM_MODEL_REPO',
    'LLM_MODEL_FILE',
    'LLM_MODEL_PATH',
    'LLM_GPU_LAYERS',
    'LLM_CONTEXT_SIZE',

    // VLM configuration
    'VLM_MODEL_REPO',
    'VLM_MODEL_FILE',
    'VLM_CLIP_FILE',
    'VLM_MODEL_PATH',
    'VLM_CLIP_PATH',
    'VLM_GPU_LAYERS',
    'VLM_CONTEXT_SIZE',

    // Vision configuration
    'CLIP_MODEL',

    // Other
    'HF_TOKEN',
    'RANKING_MODE'
  ];

  const openaiKeys = [
    'OPENAI_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_LLM_MODEL',
    'OPENAI_LLM_MODEL_EXPAND',
    'OPENAI_LLM_MODEL_REFINE',
    'OPENAI_LLM_MODEL_COMBINE',
    'OPENAI_IMAGE_MODEL',
    'OPENAI_VISION_MODEL',
    'OPENAI_MAX_RETRIES',
    'OPENAI_TIMEOUT_MS',
    'RANKING_MODE'
  ];

  const relevantKeys = mode === 'local' ? localKeys : openaiKeys;

  const filtered = {};
  for (const key of relevantKeys) {
    if (key in config) {
      filtered[key] = config[key];
    }
  }

  return filtered;
}

/**
 * Validate that a file path exists
 * @param {string} filePath - Path to validate (relative or absolute)
 * @returns {Promise<Object>} Result with exists status and resolved path
 */
export async function validatePath(filePath) {
  if (!filePath || filePath.trim() === '') {
    return { exists: false, error: 'Empty path' };
  }

  try {
    // Resolve relative paths from project root
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    await fs.access(fullPath);
    return {
      exists: true,
      path: fullPath
    };
  } catch {
    return {
      exists: false,
      path: filePath,
      error: `Path not found: ${filePath}`
    };
  }
}

/**
 * Create a backup of the .env file
 * @param {string} filePath - Path to .env file (relative to project root)
 * @returns {Promise<string>} Path to backup file
 */
export async function backupEnvFile(filePath = '.env') {
  const fullPath = path.resolve(projectRoot, filePath);
  const backupPath = `${fullPath}.backup`;

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    await fs.writeFile(backupPath, content, 'utf-8');
    return backupPath;
  } catch (error) {
    throw new Error(`Failed to create backup: ${error.message}`);
  }
}

/**
 * Reset .env to defaults from .env.example
 * Creates backup before resetting
 * @returns {Promise<Object>} Result with success status and backup path
 */
export async function resetToDefaults() {
  const envPath = path.resolve(projectRoot, '.env');
  const examplePath = path.resolve(projectRoot, '.env.example');

  try {
    // Create backup first
    const backupPath = await backupEnvFile();

    // Read .env.example
    const exampleContent = await fs.readFile(examplePath, 'utf-8');

    // Write to .env
    await fs.writeFile(envPath, exampleContent, 'utf-8');

    return {
      success: true,
      backup: backupPath
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('.env.example file not found');
    }
    throw error;
  }
}
