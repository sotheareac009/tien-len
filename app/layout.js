import { Outfit } from 'next/font/google';
import Providers from '@/components/Providers';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-ui',
});

export const metadata = {
  title: 'Tien Len — Online Card Game',
  description: 'Real-time multiplayer Tien Len played for points bought with KHQR',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
