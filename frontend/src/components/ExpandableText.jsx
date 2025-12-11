/**
 * ExpandableText Component
 *
 * Displays text with truncation and expansion indicator.
 * Shows "[+N more characters]" when text exceeds max length.
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
      {showLabel && label && (
        <strong className={styles.label}>{label}:</strong>
      )}
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
