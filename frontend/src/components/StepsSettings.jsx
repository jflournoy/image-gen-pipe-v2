/**
 * @file StepsSettings Component
 * Settings for Flux diffusion steps parameter with help text and value display
 */

import './StepsSettings.css'

export default function StepsSettings({ value = 25, onChange, helpLevel = 'basic' }) {
  const handleChange = (e) => {
    const newValue = parseInt(e.target.value, 10);
    if (!isNaN(newValue) && newValue >= 15 && newValue <= 50) {
      onChange(newValue);
    }
  };

  // Estimate generation time (rough: ~0.1s per step on 12GB GPU)
  const estimatedTime = Math.ceil(value * 0.1);

  return (
    <div className="steps-settings">
      <div className="setting-group">
        <label htmlFor="steps">
          Diffusion Steps
          <span className="current-value"> ({value})</span>
        </label>
        <input
          id="steps"
          type="range"
          min="15"
          max="50"
          step="1"
          value={value}
          onChange={handleChange}
          className="steps-slider"
          aria-label="Diffusion steps slider"
        />
        <input
          type="number"
          min="15"
          max="50"
          step="1"
          value={value}
          onChange={handleChange}
          className="steps-input"
          aria-label="Diffusion steps number input"
        />
      </div>

      <div className="setting-help">
        <p className="help-description">
          Number of diffusion steps affects image quality and generation time.
        </p>

        {(helpLevel === 'basic' || helpLevel === 'detailed') && (
          <div className="steps-quality-info">
            <div className="quality-range">
              <div className="quality-point minimum">
                <strong>15 steps</strong>: Minimum quality
              </div>
              <div className="quality-point balanced">
                <strong>25 steps</strong>: Balanced quality & speed (recommended)
              </div>
              <div className="quality-point high">
                <strong>40-50 steps</strong>: Maximum quality
              </div>
            </div>
          </div>
        )}

        {helpLevel === 'detailed' && (
          <div className="advanced-info">
            <p>
              More steps produce higher quality images but take longer to generate.
              Each step refines the image through the diffusion process.
            </p>
            <p>
              <strong>15</strong> is the minimum acceptable quality.
              <br />
              <strong>25</strong> steps is the sweet spot for most use cases.
              <br />
              <strong>40+</strong> steps for premium quality when generation time isn't critical.
            </p>
            <p className="time-estimate">
              Estimated generation time: ~{estimatedTime}s at {value} steps
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
