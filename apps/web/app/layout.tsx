import { Providers } from '../src/providers';
import { AuthProvider } from '../src/auth-provider';
import { StudioProvider, StudioShell } from '../src/studio/shell';
import './studio.css';

export const metadata = {
  title: 'Prism Studio',
  description: 'Local AI studio — chat, images and video creation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Providers>
            <StudioProvider>
              <StudioShell>{children}</StudioShell>
            </StudioProvider>
          </Providers>
        </AuthProvider>
      </body>
    </html>
  );
}
