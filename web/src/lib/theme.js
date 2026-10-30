import { useEffect, useState } from 'react';

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

/** True while the dark (AMOLED black) theme is on. Updates when the theme is switched. */
export function useIsDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const o = new MutationObserver(() => setDark(isDark()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => o.disconnect();
  }, []);
  return dark;
}

/** Colours for Recharts. SVG chart attributes cannot read CSS variables, so they come from here. */
export function useChartTheme() {
  const dark = useIsDark();
  return {
    dark,
    primary: dark ? '#3FBEA5' : '#0F6B5C',
    accent: '#F2A900',
    lost: dark ? '#C0675F' : '#D8A8A2',
    soft: dark ? '#2F7567' : '#b9d6cf',
    grid: dark ? '#4a5552' : '#8a9a95',
    cursor: dark ? 'rgba(255,255,255,.07)' : 'rgba(138,154,149,.12)',
    axis: { fill: dark ? '#96A19D' : '#7c8b87', fontSize: 12 },
    tooltip: {
      borderRadius: 8,
      fontSize: 13,
      background: dark ? '#111313' : '#ffffff',
      border: `1px solid ${dark ? '#2c3130' : '#e1e5e0'}`,
      color: dark ? '#ECF0EE' : '#14201E',
    },
    tooltipLabel: { color: dark ? '#ECF0EE' : '#14201E', fontWeight: 600 },
    tooltipItem: { color: dark ? '#ECF0EE' : '#14201E' },
    statusColors: dark ? ['#8E9FC7', '#F2A900', '#3FBEA5', '#4FC784', '#7a8581'] : ['#7C8DB5', '#F2A900', '#0F6B5C', '#2E9E5B', '#b7c0bc'],
  };
}
