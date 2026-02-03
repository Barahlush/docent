import { NextRequest, NextResponse } from 'next/server';
import { getUser } from './app/services/dal';
import { INTERNAL_BASE_URL } from './app/constants';

// Default service user credentials for auto-login in dev mode
const DEV_AUTO_LOGIN_EMAIL = 'backend@ctf-eval.local';
const DEV_AUTO_LOGIN_PASSWORD = 'ctf-eval-backend-2024';

async function autoLoginOrCreateUser(): Promise<{ user: any; setCookie: string | null }> {
  // Try to login first
  const loginResponse = await fetch(`${INTERNAL_BASE_URL}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: DEV_AUTO_LOGIN_EMAIL,
      password: DEV_AUTO_LOGIN_PASSWORD,
    }),
  });

  if (loginResponse.ok) {
    const data = await loginResponse.json();
    return {
      user: data.user,
      setCookie: loginResponse.headers.get('set-cookie'),
    };
  }

  // If login fails (user doesn't exist), create the user
  if (loginResponse.status === 401 || loginResponse.status === 404) {
    const signupResponse = await fetch(`${INTERNAL_BASE_URL}/rest/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: DEV_AUTO_LOGIN_EMAIL,
        password: DEV_AUTO_LOGIN_PASSWORD,
      }),
    });

    if (signupResponse.ok) {
      const data = await signupResponse.json();
      return {
        user: data.user,
        setCookie: signupResponse.headers.get('set-cookie'),
      };
    }
  }

  return { user: null, setCookie: null };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Check if cookies already have a user associated
  let user = await getUser();

  // If no user, ALWAYS try auto-login first (prioritize authenticated user over anonymous)
  if (!user) {
    const { user: autoUser, setCookie } = await autoLoginOrCreateUser();

    if (autoUser && setCookie) {
      const response = NextResponse.next({
        request: {
          headers: new Headers({
            ...request.headers,
            'x-middleware-user': JSON.stringify(autoUser),
            'x-middleware-cookies': setCookie || '',
          }),
        },
      });
      response.headers.set('set-cookie', setCookie);
      return response;
    }

    // If auto-login fails and this is a collection route, fall back to anonymous session
    const isCollectionRoute = pathname.match(
      /^\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/.*)?$/i
    );
    if (isCollectionRoute) {
      // Create an anonymous session
      const anonResponse = await fetch(
        `${INTERNAL_BASE_URL}/rest/anonymous_session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      const anonData = await anonResponse.json();
      user = anonData.user; // Extract user from new response format

      // Get the set-cookie header from the anonymous session response
      const setCookie = anonResponse.headers.get('set-cookie');

      // Create a new response with the cookie and user data in *request* headers
      // This is necessary for the server-side auth check in layout.tsx to work
      const response = NextResponse.next({
        request: {
          headers: new Headers({
            ...request.headers,
            'x-middleware-user': JSON.stringify(user),
            'x-middleware-cookies': setCookie || '',
          }),
        },
      });

      // Also set the *response* headers so the cookie is sent to the client
      if (setCookie) response.headers.set('set-cookie', setCookie);

      return response;
    }

    // Fallback to signup if auto-login fails and not a collection route
    return NextResponse.redirect(new URL('/signup', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
