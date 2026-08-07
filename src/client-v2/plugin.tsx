import { Plugin } from '@nocobase/client-v2';
import PluginAuthClientV2 from '@nocobase/plugin-auth/client-v2';
import { AUTH_TYPE } from '../shared/constants';

export default class PluginExternalOIDCClient extends Plugin {
  async load() {
    const auth = this.pm.get(PluginAuthClientV2);
    auth.registerType(AUTH_TYPE, {
      signInButtonLoader: () => import('./sign-in-button'),
      adminSettingsFormLoader: () => import('./settings-form'),
    });

    this.router.add('oidc-external.callback', {
      path: '/oidc-external/callback',
      skipAuthCheck: true,
      componentLoader: () => import('./callback-page'),
    });
  }
}
