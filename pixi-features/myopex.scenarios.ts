import type { Scenario } from 'myopex'

const BASE = 'http://localhost:5202'

const scenarios: Scenario[] = [
  {
    name: 'npr-technical',
    url: BASE,
    steps: [
      { click: 'role=button[name="NPR Renderer"]' },
      { waitFor: 'text=fps' },
    ],
  },
  {
    name: 'npr-risograph',
    url: BASE,
    steps: [
      { click: 'role=button[name="NPR Renderer"]' },
      { waitFor: 'text=fps' },
      { select: 'select', value: 'risograph' },
      { waitFor: 'text=Halftone' },
    ],
  },
  {
    name: 'npr-watercolor',
    url: BASE,
    steps: [
      { click: 'role=button[name="NPR Renderer"]' },
      { waitFor: 'text=fps' },
      { select: 'select', value: 'watercolor' },
    ],
  },
  {
    name: 'npr-sketch',
    url: BASE,
    steps: [
      { click: 'role=button[name="NPR Renderer"]' },
      { waitFor: 'text=fps' },
      { select: 'select', value: 'sketch' },
    ],
  },
  {
    name: 'npr-sketch-wobble',
    url: BASE,
    steps: [
      { click: 'role=button[name="NPR Renderer"]' },
      { waitFor: 'text=fps' },
      { select: 'select', value: 'sketch' },
      { click: 'input[type="checkbox"]' },
      { wait: 400 },
    ],
  },
]

export default scenarios
