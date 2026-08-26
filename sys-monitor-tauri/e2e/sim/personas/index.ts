/**
 * v1 personas — declarative data (not code). Adding a persona requires no
 * engine/driver/journey changes (spec "Reusable declarative user personas").
 */
import type { Persona } from '../types';

export const GLANCER: Persona = {
  id: 'glancer',
  description: 'Quick looks: short sessions, defaults, minimal interaction, occasionally mis-clicks.',
  thinkTimeMs: [250, 900],
  dwellTimeMs: [1200, 4000],
  actionPreference: {
    toggleSidebar: 0.2,
    setWindow: 0.3,
    toggleMetric: 0.1,
    setViewMode: 0.1,
    reorderDashboard: 0.05,
    reorderSidebar: 0.0,
    retryCard: 0.0,
    inspectSettings: 0.0,
  },
  mistakes: { escapeDropdown: 0.08, misdrag: 0.05, wrongClick: 0.05 },
  faultReaction: 'ignore',
  variance: 0.9,
};

export const CUSTOMIZER: Persona = {
  id: 'customizer',
  description: 'Personalizes the dashboard and verifies persistence across relaunches.',
  thinkTimeMs: [400, 1400],
  dwellTimeMs: [1800, 6000],
  actionPreference: {
    toggleSidebar: 0.6,
    setWindow: 0.7,
    toggleMetric: 0.8,
    setViewMode: 0.7,
    reorderDashboard: 0.8,
    reorderSidebar: 0.4,
    retryCard: 0.1,
    inspectSettings: 0.3,
  },
  mistakes: { escapeDropdown: 0.1, misdrag: 0.08, wrongClick: 0.04 },
  faultReaction: 'restart',
  variance: 0.7,
};

export const SENTINEL: Persona = {
  id: 'sentinel',
  description: 'Long watch: minutes-long sessions, wide windows, tolerant of faults (retry).',
  thinkTimeMs: [800, 2500],
  dwellTimeMs: [8000, 30000],
  actionPreference: {
    toggleSidebar: 0.3,
    setWindow: 0.9,
    toggleMetric: 0.2,
    setViewMode: 0.2,
    reorderDashboard: 0.1,
    reorderSidebar: 0.05,
    retryCard: 0.4,
    inspectSettings: 0.05,
  },
  mistakes: { escapeDropdown: 0.12, misdrag: 0.1, wrongClick: 0.02 },
  faultReaction: 'retry',
  variance: 0.8,
};

export const PERSONAS: Persona[] = [GLANCER, CUSTOMIZER, SENTINEL];

export function getPersona(id: string): Persona {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown persona: ${id}`);
  return p;
}