import type { Meta, StoryObj } from '@storybook/react-vite';

import '@/ds/tokens.css';
import '@/pages/map/map.css';
import ClientMap from './ClientMap';

const point = (email: string, ip: string, city: string, cc: string, country: string, lat: number, lon: number) => ({
  email,
  ip,
  lastSeen: 1794423797,
  lat,
  lon,
  city,
  region: '',
  country,
  countryCode: cc,
});

const meta = {
  title: 'Ovix/ClientMap',
  component: ClientMap,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Live client map: one orange pin per place (count inside when several clients share it), an animated arc from the server to each place, and a popup listing who connects from there. Tiles come from the panel tile proxy, so they are blank here.',
      },
    },
  },
  argTypes: {
    view: { description: 'Map data from GET /panel/api/ovix/geo/map.' },
    isDark: { description: 'Uses the dark tile treatment.' },
    focus: { description: 'Place key to fly to and open (from the side list).' },
    serverLabel: { description: 'Label on the server marker.' },
  },
  args: {
    isDark: false,
    focus: null,
    serverLabel: 'Server',
    view: {
      ready: true,
      downloading: false,
      updated: 1794423797,
      unlocated: 1,
      server: { ip: '64.120.95.214', lat: 1.2897, lon: 103.8501, city: 'Singapore', region: '', country: 'Singapore', countryCode: 'SG' },
      points: [
        point('kasun', '175.157.44.10', 'Colombo', 'LK', 'Sri Lanka', 6.9271, 79.8612),
        point('amal', '175.157.9.9', 'Colombo', 'LK', 'Sri Lanka', 6.9271, 79.8612),
        point('nisal2', '112.134.1.2', 'Kandy', 'LK', 'Sri Lanka', 7.2906, 80.6337),
        point('jo', '81.2.69.160', 'London', 'GB', 'United Kingdom', 51.5142, -0.0931),
        point('ravi', '49.36.1.1', 'Chennai', 'IN', 'India', 13.0827, 80.2707),
      ],
    },
  },
  render: (args) => (
    <div style={{ position: 'relative', height: 520 }}>
      <ClientMap {...args} />
    </div>
  ),
} satisfies Meta<typeof ClientMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};
