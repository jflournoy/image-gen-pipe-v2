/**
 * ExpandableText Component
 *
 * Displays text with truncation and expansion indicator.
 * Shows "[+N more characters]" when text exceeds max length.
 * Collapse button available at top when expanded for easy closing.
 */

import { useState } from 'react'
import styles from './ExpandableText.module.css'

export default function ExpandableText({
  label,
  text,
  maxLength = 80,
  showLabel = true
}) {
  const [expanded, setExpanded] = useState(false)

  if (!text) return null

  const isLong = text.length > maxLength
  const displayText = expanded ? text : text.substring(0, maxLength)
  const remaining = text.length - maxLength

  return (
    <div className={styles.expandable_text}>
      <div className={styles.header}>
        {showLabel && label && (
          <strong className={styles.label}>{label}:</strong>
        )}
        {expanded && isLong && (
          <button
            className={styles.collapse_button_top}
            onClick={() => setExpanded(false)}
            title="Show less"
          >
            [collapse]
          </button>
        )}
      </div>
      <div className={styles.text_content}>
        <p className={styles.text}>{displayText}</p>
        {isLong && !expanded && (
          <button
            className={styles.expand_button}
            onClick={() => setExpanded(true)}
            title={`Show ${remaining} more characters`}
          >
            [+{remaining} more characters]
          </button>
        )}
        {expanded && isLong && (
          <button
            className={styles.collapse_button}
            onClick={() => setExpanded(false)}
            title="Show less"
          >
            [collapse]
          </button>
        )}
      </div>
    </div>
  )
}
