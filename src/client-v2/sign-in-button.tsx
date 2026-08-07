import { useApp } from '@nocobase/client-v2';
import type { Authenticator } from '@nocobase/plugin-auth/client-v2';
import { App, Button } from 'antd';
import type { CSSProperties } from 'react';
import { AUTH_RESOURCE, DEFAULT_BUTTON_HINT, GET_AUTH_URL_ACTION } from '../shared/constants';
import { removePendingOidcFlow } from './callback';
import { createAndStorePendingOidcFlow } from './flow-binding';
import { frontendCallbackPathFrom, postSignInRedirectFrom } from './redirect-target';

const buttonContainerStyle: CSSProperties = {
  marginTop: 12,
};

const hintStyle: CSSProperties = {
  marginTop: 8,
  color: 'rgba(0, 0, 0, 0.45)',
  fontSize: 12,
  lineHeight: 1.5,
  textAlign: 'center',
};

const signInButtonStyle: CSSProperties = {
  height: 44,
  borderRadius: 12,
  fontWeight: 600,
  letterSpacing: '0.01em',
  boxShadow: '0 8px 20px rgba(22, 119, 255, 0.18)',
};

const DEFAULT_BUTTON_LABEL_EN = 'Continue with OIDC';
const DEFAULT_BUTTON_LABEL_ZH = '使用组织账号登录';
const DEFAULT_BUTTON_HINT_ZH = '点击后将跳转到组织统一身份认证，无需在此输入密码。';

interface SignInButtonProps {
  authenticator: Authenticator;
}

function browserLanguage() {
  return typeof window !== 'undefined' ? window.navigator.language : undefined;
}

function getAuthorizationUrl(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;

  const response = result as {
    data?: {
      data?: {
        url?: unknown;
      };
    };
  };
  const url = response.data?.data?.url;
  return typeof url === 'string' ? url : undefined;
}

function isChineseLanguage(language?: string) {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh');
}

function defaultButtonText(language?: string) {
  if (isChineseLanguage(language)) {
    return {
      hint: DEFAULT_BUTTON_HINT_ZH,
      label: DEFAULT_BUTTON_LABEL_ZH,
    };
  }

  return {
    hint: DEFAULT_BUTTON_HINT,
    label: DEFAULT_BUTTON_LABEL_EN,
  };
}

export function ExternalOIDCSignInButton(props: SignInButtonProps) {
  const app = useApp();
  const api = app.apiClient;
  const { message } = App.useApp();
  const defaults = defaultButtonText(api.auth.locale ?? browserLanguage());

  const signIn = async () => {
    const pending = createAndStorePendingOidcFlow(window.sessionStorage);
    try {
      const basename = app.router.getBasename();
      const redirectTo = postSignInRedirectFrom(window.location, basename);
      const result = await api.resource(AUTH_RESOURCE)[GET_AUTH_URL_ACTION]({
        values: {
          authenticator: props.authenticator?.name,
          redirectTo,
          callbackPath: frontendCallbackPathFrom(basename),
          binding: pending.binding,
        },
      });
      const url = getAuthorizationUrl(result);
      if (typeof url !== 'string') throw new Error('OIDC authorization URL is missing');
      window.location.assign(url);
    } catch (error) {
      removePendingOidcFlow(window.sessionStorage);
      const content = error instanceof Error ? error.message : 'Failed to start OIDC sign-in';
      message.error(content);
    }
  };

  return (
    <div style={buttonContainerStyle}>
      <Button block type="primary" size="large" onClick={signIn} style={signInButtonStyle}>
        {props.authenticator?.options?.buttonLabel ?? defaults.label}
      </Button>
      <div style={hintStyle}>{props.authenticator?.options?.buttonHint ?? defaults.hint}</div>
    </div>
  );
}

export default ExternalOIDCSignInButton;
