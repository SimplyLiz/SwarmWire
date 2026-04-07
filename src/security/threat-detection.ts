/**
 * Threat Detection System
 * Provides input validation, injection detection, and security monitoring
 * Inspired by Ruflo's AIDefence approach
 */

export type ThreatLevel = 'safe' | 'warning' | 'threat'

export interface ThreatResult {
  level: ThreatLevel
  detectedPatterns: ThreatPattern[]
  sanitizedInput?: string
  confidence: number
}

export interface ThreatPattern {
  type: ThreatPatternType
  description: string
  matchedContent: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export type ThreatPatternType =
  | 'injection_sql'
  | 'injection_command'
  | 'injection_script'
  | 'path_traversal'
  | 'hardcoded_secret'
  | 'prompt_injection'
  | 'jailbreak_attempt'
  | 'pii_detected'
  | 'dangerous_function'

export interface ThreatDetectionConfig {
  /** Enable specific checks */
  checkSqlInjection?: boolean
  checkCommandInjection?: boolean
  checkPathTraversal?: boolean
  checkHardcodedSecrets?: boolean
  checkPromptInjection?: boolean
  checkPII?: boolean
  /** Minimum severity to flag as warning */
  minWarningSeverity?: 'low' | 'medium' | 'high' | 'critical'
  /** Whether to auto-sanitize dangerous input */
  autoSanitize?: boolean
}

// Regex patterns for threat detection
const THREAT_PATTERNS: Record<ThreatPatternType, { pattern: RegExp; severity: 'low' | 'medium' | 'high' | 'critical'; description: string }> = {
  injection_sql: {
    pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b.*\b(FROM|INTO|TABLE|WHERE)\b)|(--|\/\*|\*\/|;|\bor\b|\band\b)/i,
    severity: 'high',
    description: 'SQL injection attempt detected'
  },
  injection_command: {
    pattern: /[`$](.*?)(&&|\|\||;|\||>|<)|\$\(.*?\)|\{.*?\}/,
    severity: 'high',
    description: 'Command injection attempt detected'
  },
  injection_script: {
    pattern: /<script[^>]*>|javascript:|on\w+\s*=|<iframe|<object|<embed/gi,
    severity: 'critical',
    description: 'XSS/script injection attempt detected'
  },
  path_traversal: {
    pattern: /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|%2e%2e%5c|etc\/passwd|boot\.ini|c:\windows)/i,
    severity: 'high',
    description: 'Path traversal attempt detected'
  },
  hardcoded_secret: {
    pattern: /(api[_-]?key|secret[_-]?key|password|passwd|pwd|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"]?[a-zA-Z0-9_\-]{20,}['"]?/i,
    severity: 'critical',
    description: 'Hardcoded secret detected'
  },
  prompt_injection: {
    pattern: /(ignore previous|ignore all|forget everything|disregard|system prompt|you are now|act as|pretend to be)/i,
    severity: 'medium',
    description: 'Prompt injection attempt detected'
  },
  jailbreak_attempt: {
    pattern: /(DAN|do anything now|jailbreak|roleplay.*evil|bypass.*restriction|dev mode|developer mode)/i,
    severity: 'critical',
    description: 'Jailbreak attempt detected'
  },
  pii_detected: {
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b|\b[A-Z]{2}\d{6,9}\b|\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b|\b[\w\.-]+@[\w\.-]+\.\w{2,}\b/,
    severity: 'medium',
    description: 'Potential PII detected'
  },
  dangerous_function: {
    pattern: /\b(eval|exec|system|popen|shell_exec|passthru|subprocess|os\.system|subprocess\.run)\s*\(/i,
    severity: 'high',
    description: 'Dangerous function call detected'
  }
}

// PII patterns for detection
const PII_PATTERNS = {
  email: /\b[\w\.-]+@[\w\.-]+\.\w{2,}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  phone: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
}

export function createThreatDetector(config: ThreatDetectionConfig = {}) {
  const {
    checkSqlInjection = true,
    checkCommandInjection = true,
    checkPathTraversal = true,
    checkHardcodedSecrets = true,
    checkPromptInjection = true,
    checkPII = true,
    minWarningSeverity = 'medium',
    autoSanitize = false
  } = config

  const severityOrder: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
  const minSeverityIndex = severityOrder[minWarningSeverity]

  return {
    /**
     * Scan input for threats
     */
    scan(input: string): ThreatResult {
      const detectedPatterns: ThreatPattern[] = []

      // Check each enabled threat type
      if (checkSqlInjection) {
        const match = THREAT_PATTERNS.injection_sql.pattern.exec(input)
        if (match) {
          detectedPatterns.push({
            type: 'injection_sql',
            description: THREAT_PATTERNS.injection_sql.description,
            matchedContent: match[0],
            severity: THREAT_PATTERNS.injection_sql.severity as 'low' | 'medium' | 'high' | 'critical'
          })
        }
      }

      if (checkCommandInjection) {
        const matches = input.match(THREAT_PATTERNS.injection_command.pattern)
        if (matches) {
          for (const match of matches) {
            detectedPatterns.push({
              type: 'injection_command',
              description: THREAT_PATTERNS.injection_command.description,
              matchedContent: match,
              severity: 'high'
            })
          }
        }
      }

      if (checkPathTraversal) {
        const matches = input.match(THREAT_PATTERNS.path_traversal.pattern)
        if (matches) {
          for (const match of matches) {
            detectedPatterns.push({
              type: 'path_traversal',
              description: THREAT_PATTERNS.path_traversal.description,
              matchedContent: match,
              severity: 'high'
            })
          }
        }
      }

      if (checkHardcodedSecrets) {
        const matches = input.match(THREAT_PATTERNS.hardcoded_secret.pattern)
        if (matches) {
          for (const match of matches) {
            detectedPatterns.push({
              type: 'hardcoded_secret',
              description: THREAT_PATTERNS.hardcoded_secret.description,
              matchedContent: match.substring(0, 50) + '...',
              severity: 'critical'
            })
          }
        }
      }

      if (checkPromptInjection) {
        const matches = input.match(THREAT_PATTERNS.prompt_injection.pattern)
        if (matches) {
          for (const match of matches) {
            detectedPatterns.push({
              type: 'prompt_injection',
              description: THREAT_PATTERNS.prompt_injection.description,
              matchedContent: match,
              severity: 'medium'
            })
          }
        }
      }

      if (checkPII) {
        const piiMatches = input.match(THREAT_PATTERNS.pii_detected.pattern)
        if (piiMatches) {
          for (const match of piiMatches) {
            detectedPatterns.push({
              type: 'pii_detected',
              description: THREAT_PATTERNS.pii_detected.description,
              matchedContent: match.substring(0, 30) + (match.length > 30 ? '...' : ''),
              severity: 'medium'
            })
          }
        }
      }

      // Determine threat level
      let level: ThreatLevel = 'safe'
      let confidence = 0.95

      if (detectedPatterns.length > 0) {
        const maxSeverity = detectedPatterns.reduce((max, p) => 
          (severityOrder[p.severity] ?? 0) > (severityOrder[max.severity] ?? 0) ? p : max
        , detectedPatterns[0]!)

        const severityIndex = severityOrder[maxSeverity.severity] ?? 0

        if (severityIndex >= (severityOrder.critical ?? 3)) {
          level = 'threat'
          confidence = 0.98
        } else if (severityIndex >= (severityOrder.high ?? 2)) {
          level = 'threat'
          confidence = 0.9
        } else if (severityIndex >= (minSeverityIndex ?? 1)) {
          level = 'warning'
          confidence = 0.7
        }
      }

      // Optionally sanitize
      let sanitizedInput: string | undefined
      if (autoSanitize && level !== 'safe') {
        sanitizedInput = sanitizeInput(input, detectedPatterns)
      }

      return {
        level,
        detectedPatterns,
        sanitizedInput,
        confidence
      }
    },

    /**
     * Quick check - returns true if input is safe
     */
    isSafe(input: string): boolean {
      return this.scan(input).level === 'safe'
    },

    /**
     * Get list of detected PII types
     */
    detectPII(input: string): Array<{ type: string; value: string }> {
      const findings: Array<{ type: string; value: string }> = []

      for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        const matches = input.match(pattern)
        if (matches) {
          for (const match of matches) {
            findings.push({ type, value: match })
          }
        }
      }

      return findings
    }
  }

  function sanitizeInput(input: string, patterns: ThreatPattern[]): string {
    let sanitized = input
    
    // Remove matched patterns (simplified - real implementation would be more sophisticated)
    for (const pattern of patterns) {
      if (pattern.severity === 'high' || pattern.severity === 'critical') {
        // Replace with placeholder
        sanitized = sanitized.split(pattern.matchedContent).join('[REDACTED]')
      }
    }

    return sanitized
  }
}

/**
 * Default threat detection configuration
 */
export const defaultThreatConfig: ThreatDetectionConfig = {
  checkSqlInjection: true,
  checkCommandInjection: true,
  checkPathTraversal: true,
  checkHardcodedSecrets: true,
  checkPromptInjection: true,
  checkPII: true,
  minWarningSeverity: 'medium',
  autoSanitize: false
}