import type { Report } from './domain';

export const SAMPLE_TRANSCRIPT = 'At 42 Oak Street, a parked truck blocked the delivery exit. I had to reverse into the narrow lane and stopped when a cyclist passed behind the van. There was no contact. The loading area needs a clear exit.';

const examples: { transcript: string; title: string; location: string; category: Report['category']; maneuver: string }[] = [
  { transcript: SAMPLE_TRANSCRIPT, title: 'Blocked exit required reversing', location: '42 Oak Street', category: 'Obstructed access', maneuver: 'Reversed into the lane; stopped for a cyclist.' },
  { transcript: 'At 42 Oak Street, delivery access was blocked by parked vehicles again. I waited until the loading exit was clear instead of backing into traffic. No contact occurred.', title: 'Delivery exit blocked again', location: '42 Oak Street', category: 'Obstructed access', maneuver: 'Waited for the exit to clear.' },
  { transcript: 'On Pine Road, loose gravel made the driveway slippery. I slowed down and stopped before reaching the steep section. No contact occurred.', title: 'Loose gravel on a steep driveway', location: 'Pine Road', category: 'Road or weather conditions', maneuver: 'Slowed and stopped before the slope.' },
  { transcript: 'At 18 Cedar Lane, a dog ran through an open gate toward the van. I stayed inside the vehicle until the owner secured it. There was no contact.', title: 'Unsecured dog at delivery entrance', location: '18 Cedar Lane', category: 'Animal encounter', maneuver: 'Stayed in the vehicle.' },
  { transcript: 'Near Pine Road, loose stones reduced traction on the sloped delivery entrance. I stopped and chose a different place to park. There was no contact.', title: 'Poor traction at the delivery entrance', location: 'Pine Road', category: 'Road or weather conditions', maneuver: 'Stopped and changed parking location.' },
];

export function createDemoReports(): Report[] {
  const now = Date.now();
  return examples.map((example, index) => ({
    ...example, id: crypto.randomUUID(),
    createdAt: new Date(now - index * 3600000).toISOString(), updatedAt: new Date(now).toISOString(),
    occurredAt: '', source: 'demo', extraction: 'Authored synthetic example',
    outcome: 'Near miss / no contact', evidence: example.transcript, confirmed: true,
  }));
}
