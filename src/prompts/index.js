/**
 * Centralized prompt registry for SDXL image generation pipeline
 *
 * Single source of truth for shared LLM system prompts used across providers.
 * Provider-specific prompts (critique, ranking, vision evaluation) stay in their
 * respective service files.
 */

module.exports = {
  ...require('./negative'),
  ...require('./combine'),
  ...require('./expand'),
  ...require('./refine'),
};
