import { Alert, Checkbox, Form, Input } from 'antd';
import { DEFAULT_BUTTON_HINT, DEFAULT_BUTTON_LABEL, DEFAULT_EMAIL_CLAIM, DEFAULT_ISSUER, DEFAULT_NICKNAME_CLAIM, DEFAULT_SCOPE, DEFAULT_USERNAME_CLAIM } from '../shared/constants';

const requiredRule = { required: true } as const;

export function ExternalOIDCSettingsForm() {
  return (
    <>
      <Alert
        style={{ marginBottom: 16 }}
        type="warning"
        showIcon
        message="Keep client secrets in environment variables"
        description="Set clientSecretEnv to an environment variable name. Avoid storing clientSecret in NocoBase database unless this is only a temporary test environment."
      />
      <Form.Item name={['options', 'issuer']} label="Issuer" initialValue={DEFAULT_ISSUER} rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'clientId']} label="Client ID" rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item
        name={['options', 'clientSecretEnv']}
        label="Client secret env"
        initialValue="NOCOBASE_OIDC_CLIENT_SECRET"
      >
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'redirectUri']} label="Redirect URI" rules={[requiredRule]}>
        <Input placeholder="https://nocobase.example.com/api/oidc-external:redirect" />
      </Form.Item>
      <Form.Item name={['options', 'scope']} label="Scope" initialValue={DEFAULT_SCOPE} rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'usernameClaim']} label="Username claim" initialValue={DEFAULT_USERNAME_CLAIM}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'nicknameClaim']} label="Nickname claim" initialValue={DEFAULT_NICKNAME_CLAIM}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'emailClaim']} label="Email claim" initialValue={DEFAULT_EMAIL_CLAIM}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'buttonLabel']} label="Button label" initialValue={DEFAULT_BUTTON_LABEL}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'buttonHint']} label="Button hint" initialValue={DEFAULT_BUTTON_HINT}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'autoSignUp']} label="Auto sign up" valuePropName="checked" initialValue>
        <Checkbox />
      </Form.Item>
    </>
  );
}

export default ExternalOIDCSettingsForm;
