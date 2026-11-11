import type { Meta, StoryObj } from '@storybook/react-vite';

import { SizeFormatter } from '@/utils';
import '@/ds/tokens.css';
import './dashboard.css';
import LiveNetwork from './LiveNetwork';

const MB = 125_000;

const meta = {
  title: 'Ovix/LiveNetwork',
  component: LiveNetwork,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Dashboard canvas map: server, the inbounds in use, and the busiest online clients. Link width and packet rate follow each client live speed; frames stop off screen and under reduced motion.',
      },
    },
  },
  argTypes: {
    inbounds: { description: 'Inbounds that can appear as the middle column.' },
    clients: { description: 'Online clients with their inbound ids and live speed in bytes/s.' },
    serverLabel: { description: 'Text inside the server node.' },
    serverSub: { description: 'Small text under the server label.' },
    idleLabel: { description: 'Shown under a client that is online but moving no data.' },
    formatRate: { description: 'Formats a client speed (bytes/s) for its label.' },
    themeKey: { description: 'Changes when the theme changes so colours are read again.' },
    ariaLabel: { description: 'Text alternative for the canvas.' },
  },
  args: {
    inbounds: [
      { id: 1, label: 'VLESS 443' },
      { id: 2, label: 'TROJAN 8443' },
    ],
    clients: [
      { email: 'nisal2', inboundIds: [1], rate: 18.4 * MB },
      { email: 'sachi_k', inboundIds: [1], rate: 11 * MB },
      { email: 'gaviya', inboundIds: [2], rate: 6.1 * MB },
      { email: 'mr_hera', inboundIds: [1], rate: 2.3 * MB },
      { email: 'dilshan99', inboundIds: [2], rate: 0.4 * MB },
      { email: 'ranshika', inboundIds: [1], rate: 0 },
      { email: 'ravi.p', inboundIds: [2], rate: 3.2 * MB },
    ],
    serverLabel: 'Server',
    serverSub: 'Xray 26.10.10',
    idleLabel: 'idle',
    formatRate: SizeFormatter.speedFormat,
    themeKey: 'light',
    ariaLabel: 'Live network map',
  },
  render: (args) => (
    <div className="ovd-card ovd-flow" style={{ maxWidth: 860 }}>
      <LiveNetwork {...args} />
    </div>
  ),
} satisfies Meta<typeof LiveNetwork>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Busy: Story = {};

export const NobodyOnline: Story = { args: { clients: [] } };
