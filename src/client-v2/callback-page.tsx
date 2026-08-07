import { useApp } from '@nocobase/client-v2';
import { Button, Result, Spin, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeOidcCallbackInBrowser } from './callback';

const SIGN_IN_PATH = '/signin';

export default function ExternalOIDCCallbackPage() {
  const apiClient = useApp().apiClient;
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const started = useRef(false);
  const [failure, setFailure] = useState<string>();

  const signIn = useCallback(() => {
    navigate(SIGN_IN_PATH, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    setFailure(undefined);

    completeOidcCallbackInBrowser(apiClient, window, document.title, navigate)
      .then((completed) => {
        if (active && !completed) setFailure('The sign-in request is missing or has expired.');
      })
      .catch(() => {
        if (active) setFailure('The secure sign-in exchange failed. No credentials were exposed.');
      });

    return () => {
      active = false;
    };
  }, [apiClient, navigate]);

  return (
    <main
      aria-live="polite"
      style={{
        alignItems: 'center',
        background: token.colorBgLayout,
        display: 'flex',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: token.paddingLG,
      }}
    >
      {failure ? (
        <Result
          status="error"
          title="Sign-in could not be completed"
          subTitle={failure}
          extra={
            <Button type="primary" onClick={signIn}>
              Try sign-in again
            </Button>
          }
        />
      ) : (
        <Result
          icon={<Spin size="large" />}
          title="Completing sign-in"
          subTitle="Please wait while your secure session is prepared."
        />
      )}
    </main>
  );
}
