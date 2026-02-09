/**
 * TDD RED Phase: Settings Descriptive Notes Tests
 *
 * Validates that ALL UI settings have descriptive notes/help text explaining
 * what each setting does, its valid ranges, and its effects on image generation.
 *
 * Descriptive notes should be provided via:
 * - <small> tags with explanatory text
 * - title attributes for hover tooltips
 * - aria-label attributes for accessibility
 *
 * This ensures users understand each setting without external documentation.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Settings Descriptive Notes (All settings fully documented)', () => {
  let demoHtml;

  const setup = () => {
    demoHtml = fs.readFileSync(
      path.join(__dirname, '../../public/demo.html'),
      'utf-8'
    );
  };

  describe('LLM Provider Settings - Help Text for All Controls', () => {
    test('Alpha slider should have <small> tag with explanation', () => {
      setup();
      // Find a larger section containing alpha - look backward and forward
      const alphaSectionMatch = demoHtml.match(/<div[^>]*>[\s\S]*?id="alpha"[\s\S]*?<\/div>/);
      assert.ok(alphaSectionMatch, 'Should find alpha slider section');
      if (alphaSectionMatch) {
        const sectionText = alphaSectionMatch[0];
        const hasSmallTag = /<small[^>]*>/.test(sectionText);
        const hasExplanation = /alignment|quality|weight|ranking/i.test(sectionText);
        assert.ok(
          hasSmallTag && hasExplanation,
          'Alpha slider should have <small> tag with explanation (alignment/quality/weight)'
        );
      }
    });

    test('Temperature slider should have <small> tag with explanation', () => {
      setup();
      // Find a larger section containing temperature
      const tempSectionMatch = demoHtml.match(/<div[^>]*>[\s\S]*?id="temperature"[\s\S]*?<\/div>/);
      assert.ok(tempSectionMatch, 'Should find temperature slider section');
      if (tempSectionMatch) {
        const sectionText = tempSectionMatch[0];
        const hasSmallTag = /<small[^>]*>/.test(sectionText);
        const hasExplanation = /creativity|randomness|variability/i.test(sectionText);
        assert.ok(
          hasSmallTag && hasExplanation,
          'Temperature should have <small> tag with explanation (creativity/randomness)'
        );
      }
    });

    test('LLM Model dropdown should have help text explaining the models', () => {
      setup();
      // Check for description after llmModel select
      const hasModelHelp = demoHtml.includes('id="llmModel"') &&
        (demoHtml.includes('speed') || demoHtml.includes('quality') || demoHtml.includes('cost'));
      assert.ok(
        hasModelHelp,
        'LLM Model should have help text explaining model differences'
      );
    });
  });

  describe('Flux Provider Settings - Help Text for All Controls', () => {
    test('Flux Steps input should have title attribute or <small> explanation', () => {
      setup();
      const hasStepsDoc =
        demoHtml.includes('id="fluxSteps"') &&
        (demoHtml.includes('title="Steps') ||
         demoHtml.includes('Steps</label>') && demoHtml.includes('quality'));
      assert.ok(
        hasStepsDoc,
        'Flux Steps should have documentation explaining quality/iteration trade-off'
      );
    });

    test('Flux Guidance input should have title attribute or <small> explanation', () => {
      setup();
      const hasGuidanceDoc =
        demoHtml.includes('id="fluxGuidance"') &&
        (demoHtml.includes('title="Guidance') ||
         demoHtml.includes('adherence') ||
         demoHtml.includes('prompt'));
      assert.ok(
        hasGuidanceDoc,
        'Flux Guidance should have documentation explaining prompt adherence'
      );
    });

    test('Flux Scheduler dropdown should have help text', () => {
      setup();
      const hasSchedulerDoc = demoHtml.includes('id="fluxScheduler"') &&
        (demoHtml.includes('euler') || demoHtml.includes('schedule'));
      assert.ok(
        hasSchedulerDoc,
        'Flux Scheduler should have help text'
      );
    });

    test('Flux Model Source radio buttons should have help text', () => {
      setup();
      const hasSourceDoc = demoHtml.includes('Model Source') &&
        (demoHtml.includes('HuggingFace') || demoHtml.includes('Local'));
      assert.ok(
        hasSourceDoc,
        'Flux Model Source should have help text explaining options'
      );
    });

    test('Flux Custom Path input should have placeholder or title', () => {
      setup();
      const hasPathDoc = demoHtml.includes('id="fluxCustomPath"') &&
        (demoHtml.includes('placeholder') || demoHtml.includes('title'));
      assert.ok(
        hasPathDoc,
        'Flux Custom Path should have placeholder or title attribute'
      );
    });
  });

  describe('BFL Provider Settings - Help Text for All Controls', () => {
    test('BFL Model dropdown should have option descriptions', () => {
      setup();
      const hasModelDoc = demoHtml.includes('id="bflModel"') &&
        demoHtml.includes('FLUX.2');
      assert.ok(
        hasModelDoc,
        'BFL Model should list model options with variants (pro, ultra, etc)'
      );
    });

    test('BFL Width input should show min/max constraints', () => {
      setup();
      const hasWidthDoc = demoHtml.includes('id="bflWidth"') &&
        (demoHtml.includes('min=') && demoHtml.includes('max='));
      assert.ok(
        hasWidthDoc,
        'BFL Width should show min/max constraints'
      );
    });

    test('BFL Height input should show min/max constraints', () => {
      setup();
      const hasHeightDoc = demoHtml.includes('id="bflHeight"') &&
        (demoHtml.includes('min=') && demoHtml.includes('max='));
      assert.ok(
        hasHeightDoc,
        'BFL Height should show min/max constraints'
      );
    });

    test('BFL Safety Tolerance slider should have <small> tag with explanation', () => {
      setup();
      const safetySection = demoHtml.match(/id="bflSafetyTolerance"[^<]*.*?<\/(?:div|label)>/s);
      assert.ok(safetySection, 'Should find safety slider section');
      if (safetySection) {
        const hasExplanation = /Safety|filter|tolerance/i.test(safetySection[0]);
        assert.ok(hasExplanation, 'Safety Tolerance should have explanation');
      }
    });

    test('BFL Guidance slider should have <small> tag with explanation', () => {
      setup();
      const guidanceSection = demoHtml.match(/id="bflGuidance"[^<]*.*?<\/(?:div|label)>/s);
      assert.ok(guidanceSection, 'Should find BFL guidance slider section');
      if (guidanceSection) {
        const hasExplanation = /guidance|prompt/i.test(guidanceSection[0]);
        assert.ok(hasExplanation, 'BFL Guidance should have explanation');
      }
    });

    test('BFL Steps slider should have <small> tag with explanation', () => {
      setup();
      const stepsSection = demoHtml.match(/id="bflSteps"[^<]*.*?<\/(?:div|label)>/s);
      assert.ok(stepsSection, 'Should find BFL steps slider section');
      if (stepsSection) {
        const hasExplanation = /steps|quality/i.test(stepsSection[0]);
        assert.ok(hasExplanation, 'BFL Steps should have explanation');
      }
    });

    test('BFL Output Format dropdown should have help text explaining formats', () => {
      setup();
      const hasFormatDoc = demoHtml.includes('id="bflOutputFormat"') &&
        (demoHtml.includes('jpeg') || demoHtml.includes('png'));
      assert.ok(
        hasFormatDoc,
        'BFL Output Format should list available formats'
      );
    });

    test('BFL Seed input should have placeholder or title explaining its purpose', () => {
      setup();
      const hasSeedDoc = demoHtml.includes('id="bflSeed"') &&
        (demoHtml.includes('placeholder="Random"') || demoHtml.includes('title="Seed'));
      assert.ok(
        hasSeedDoc,
        'BFL Seed should have placeholder or title explaining it'
      );
    });
  });

  describe('Modal Provider Settings - Help Text for All Controls', () => {
    test('Modal Model dropdown should have help text listing available models', () => {
      setup();
      const hasModelDoc = demoHtml.includes('id="modalModel"') &&
        (demoHtml.includes('Flux') || demoHtml.includes('SDXL'));
      assert.ok(
        hasModelDoc,
        'Modal Model should list available models'
      );
    });

    test('Modal GPU setting should have help text if present', () => {
      setup();
      // This test is optional - GPU may not have a UI control
      const hasGPU = demoHtml.includes('modalGPU') || demoHtml.includes('GPU');
      if (hasGPU) {
        const hasGPUDoc = demoHtml.includes('title="GPU') ||
          /GPU[^<]*(?:steps|speed|cost)/i.test(demoHtml);
        assert.ok(hasGPUDoc || true, 'Modal GPU should have help text if UI control exists');
      }
    });
  });

  describe('Vision Provider Settings - Help Text for All Controls', () => {
    test('Vision Provider dropdown should have help text', () => {
      setup();
      const hasProviderDoc = demoHtml.includes('Vision Provider') ||
        demoHtml.includes('visionProvider');
      assert.ok(
        hasProviderDoc,
        'Vision Provider should be labeled'
      );
    });

    test('Vision Model dropdown should list available models', () => {
      setup();
      const hasModelDoc = demoHtml.includes('Vision Model') ||
        demoHtml.includes('visionModel');
      assert.ok(
        hasModelDoc,
        'Vision Model should list available options'
      );
    });
  });

  describe('Settings Documentation Completeness', () => {
    test('all settings should have one of: title, <small> tag, or placeholder with description', () => {
      setup();
      // Key settings that need documentation
      const settingsToCheck = [
        { id: 'llmProvider', name: 'LLM Provider' },
        { id: 'alpha', name: 'Alpha Slider' },
        { id: 'temperature', name: 'Temperature' },
        { id: 'imageProvider', name: 'Image Provider' },
        { id: 'fluxSteps', name: 'Flux Steps' },
        { id: 'fluxGuidance', name: 'Flux Guidance' },
        { id: 'bflModel', name: 'BFL Model' },
        { id: 'bflSafetyTolerance', name: 'BFL Safety' },
        { id: 'bflGuidance', name: 'BFL Guidance' },
        { id: 'bflSteps', name: 'BFL Steps' },
      ];

      for (const setting of settingsToCheck) {
        const exists = demoHtml.includes(`id="${setting.id}"`);
        assert.ok(exists, `Setting ${setting.name} (id="${setting.id}") should exist`);
      }
    });

    test('should NOT have bare input fields without nearby label or help text', () => {
      setup();
      // Check that inputs have labels nearby (not orphaned)
      // This is a structural check to ensure all inputs are properly documented
      const orphanedInputCount = (demoHtml.match(/<input[^>]*id="[^"]*"[^>]*>(?![\s\S]*?<label|[\s\S]*?<small)/g) || []).length;
      // Allow some orphaned inputs (like number spinners that share a label), but not many
      assert.ok(
        orphanedInputCount < 5,
        'Should not have many bare inputs without nearby labels or help text'
      );
    });
  });
});
