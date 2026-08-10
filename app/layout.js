import './globals.css';

export const metadata = {
  title: 'Tien Len — Online Card Game',
  description: 'Real-time multiplayer Tien Len with KHQR payouts per round',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
