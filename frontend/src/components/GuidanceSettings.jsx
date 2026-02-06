/**
 * @file GuidanceSettings Component
 * Settings for Flux guidance parameter with help text and value display
 */

import './GuidanceSettings.css'

export default function GuidanceSettings({ value = 3.5, onChange, helpLevel = 'basic' }) {
  const handleChange = (e) => {
    const newValue = parseFloat(e.target.value);
    if (!isNaN(newValue) && newValue >= 1 && newValue <= 20) {
      onChange(newValue);
    }
  };

  return (
    <div className="guidance-settings">
      <div className="setting-group">
        <label htmlFor="guidance">
          Guidance Scale
          <span className="current-value"> ({value.toFixed(1)})</span>
        </label>
        <input
          id="guidance"
          type="range"
          min="1"
          max="20"
          step="0.5"
          value={value}
          onChange={handleChange}
          className="guidance-slider"
          aria-label="Guidance scale slider"
        />
        <input
          type="number"
          min="1"
          max="20"
          step="0.5"
          value={value}
          onChange={handleChange}
          className="guidance-input"
          aria-label="Guidance scale number input"
        />
      </div>

      <div className="setting-help">
        <p className="help-description">
          Guidance scale controls how strongly the model follows your prompt.
        </p>

        {(helpLevel === 'basic' || helpLevel === 'detailed') && (
          <div className="guidance-scale-info">
            <div className="scale-range">
              <div className="scale-point low">
                <strong>1-5</strong>: More creative, less literal
              </div>
              <div className="scale-point mid">
                <strong>5-10</strong>: Balanced (3.5 default)
              </div>
              <div className="scale-point high">
                <strong>10-20</strong>: Literal, closely follows prompt
              </div>
            </div>
          </div>
        )}

        {helpLevel === 'detailed' && (
          <div className="advanced-info">
            <p>
              Lower values (1-5) give the model more creative freedom, resulting in
              more diverse and artistic interpretations. Higher values (15-20) make
              the model strictly adhere to your prompt description.
            </p>
            <p>
              <strong>3.5</strong> is the recommended default that balances
              quality and creativity.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
