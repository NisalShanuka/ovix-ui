import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfigProvider, Form, Input, Spin, message } from 'antd';
import {
  KeyOutlined,
  LockOutlined,
  MoonOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { FormProvider, useForm } from 'react-hook-form';
import { HttpUtil } from '@/utils';
import { FormField, rhfZodValidate } from '@/components/form/rhf';
import { setMessageInstance } from '@/utils/messageBus';
import { useTheme } from '@/hooks/useTheme';
import { BrandMark } from '@/ds/BrandMark';
import { LoginFormSchema, TwoFactorCodeSchema, type LoginFormValues } from '@/schemas/login';
import './LoginPage.css';

type LoginForm = LoginFormValues;

const basePath = window.X_UI_BASE_PATH || '';

const POINTS = ['pages.login.point1', 'pages.login.point2', 'pages.login.point3'] as const;

export default function LoginPage() {
  const { t } = useTranslation();
  const { isDark, toggleTheme, antdThemeConfig } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();

  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const [fetched, setFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [twoFactorEnable, setTwoFactorEnable] = useState(false);
  const methods = useForm<LoginForm>({
    defaultValues: { username: '', password: '', twoFactorCode: '' },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const msg = await HttpUtil.post('/getTwoFactorEnable');
      if (cancelled) return;
      if (msg.success) setTwoFactorEnable(!!msg.obj);
      setFetched(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = useCallback(async (values: LoginForm) => {
    setSubmitting(true);
    try {
      const msg = await HttpUtil.post('/login', values);
      if (msg.success) window.location.href = basePath + 'panel/';
    } finally {
      setSubmitting(false);
    }
  }, []);

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      <div className="ovl-app">
        <aside className="ovl-brand">
          <div className="ovl-brand-top">
            <BrandMark caption={t('pages.login.caption')} />
          </div>
          <div className="ovl-brand-copy">
            <h1>{t('pages.login.headline')}</h1>
            <p>{t('pages.login.sub')}</p>
            <ul>
              {POINTS.map((key, i) => (
                <li key={key} style={{ animationDelay: `${200 + i * 90}ms` }}>
                  <i />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
          <svg className="ovl-orbit" viewBox="0 0 400 400" aria-hidden="true">
            <circle cx="200" cy="200" r="150" />
            <circle cx="200" cy="200" r="100" />
            <circle className="ovl-orbit-dot" cx="350" cy="200" r="5" />
          </svg>
        </aside>

        <main className="ovl-main">
          <button
            type="button"
            className="ovl-theme"
            aria-label={t('menu.theme')}
            title={t('menu.theme')}
            onClick={toggleTheme}
          >
            {isDark ? <SunOutlined /> : <MoonOutlined />}
          </button>

          <div className="ovl-card">
            <div className="ovl-card-brand">
              <BrandMark />
            </div>
            <h2>{t('pages.login.title')}</h2>
            <p className="ovl-card-sub">{t('pages.login.signInSub')}</p>

            {!fetched ? (
              <div className="ovl-loading">
                <Spin size="large" />
              </div>
            ) : (
              <FormProvider {...methods}>
                <Form
                  layout="vertical"
                  className="ovl-form"
                  requiredMark={false}
                  onFinish={methods.handleSubmit(onSubmit)}
                >
                  <FormField
                    name="username"
                    label={t('username')}
                    rules={{ validate: rhfZodValidate(LoginFormSchema.shape.username) }}
                  >
                    <Input
                      prefix={<UserOutlined />}
                      autoComplete="username"
                      size="large"
                      placeholder={t('username')}
                      autoFocus
                    />
                  </FormField>

                  <FormField
                    name="password"
                    label={t('password')}
                    rules={{ validate: rhfZodValidate(LoginFormSchema.shape.password) }}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      autoComplete="current-password"
                      size="large"
                      placeholder={t('password')}
                    />
                  </FormField>

                  {twoFactorEnable && (
                    <FormField
                      name="twoFactorCode"
                      label={t('twoFactorCode')}
                      rules={{ validate: rhfZodValidate(TwoFactorCodeSchema) }}
                    >
                      <Input
                        prefix={<KeyOutlined />}
                        autoComplete="one-time-code"
                        size="large"
                        placeholder={t('twoFactorCode')}
                      />
                    </FormField>
                  )}

                  <Form.Item className="ovl-submit">
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={submitting}
                      size="large"
                      block
                    >
                      {t('login')}
                    </Button>
                  </Form.Item>
                </Form>
              </FormProvider>
            )}
          </div>
          <p className="ovl-foot">OVIX STORE VPN · {t('pages.login.caption')}</p>
        </main>
      </div>
    </ConfigProvider>
  );
}
