import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  CalendarOutlined,
  CopyOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  LinkOutlined,
  LogoutOutlined,
  MoonOutlined,
  MoreOutlined,
  PlusOutlined,
  RetweetOutlined,
  SunOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';

import Credit from '@/ds/Credit';
import { useTheme } from '@/hooks/useTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ClipboardManager, HttpUtil, SizeFormatter } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import { FormField, useZodForm } from '@/components/form/rhf';
import {
  fetchMe,
  fetchMyClientLinks,
  fetchMyClients,
  fetchMyLedger,
  ovixApi,
  ovixKeys,
  type ClientView,
  type LedgerRow,
} from '@/api/ovix';
import { expiryState, formatDateTime, reasonLabel } from '@/pages/resellers/format';
import '@/pages/resellers/resellers.css';

const GB = 1024 ** 3;
const MAX_DAYS = 3650;
const POLL_MS = 15_000;

const NewClientSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'pages.resellerPortal.emailRequired')
    .regex(/^[^\s]+$/, 'pages.resellerPortal.emailNoSpaces'),
  days: z
    .number()
    .int()
    .min(1, 'pages.resellerPortal.daysRange')
    .max(MAX_DAYS, 'pages.resellerPortal.daysRange'),
  inboundIds: z.array(z.number().int()).min(1, 'pages.resellerPortal.inboundRequired'),
  trafficLimitGB: z.number().int().min(0),
  limitIp: z.number().int().min(0),
  comment: z.string(),
  tgId: z.number().int().min(0),
  startOnFirstUse: z.boolean(),
});
type NewClientValues = z.infer<typeof NewClientSchema>;

const EditClientSchema = z.object({
  enable: z.boolean(),
  trafficLimitGB: z.number().int().min(0),
  limitIp: z.number().int().min(0),
  comment: z.string(),
  tgId: z.number().int().min(0),
});
type EditClientValues = z.infer<typeof EditClientSchema>;

const intInput = { output: (v: unknown) => (typeof v === 'number' ? v : 0) };

export default function ResellerPortalPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, toggleTheme, antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const [modal, modalContextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);
  useEffect(() => {
    document.title = t('pages.resellerPortal.title');
  }, [t]);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ovixKeys.root() });

  const meQuery = useQuery({ queryKey: ovixKeys.me(), queryFn: fetchMe, refetchInterval: POLL_MS });
  const clientsQuery = useQuery({
    queryKey: ovixKeys.myClients(),
    queryFn: fetchMyClients,
    refetchInterval: POLL_MS,
  });
  const ledgerQuery = useQuery({ queryKey: ovixKeys.myLedger(), queryFn: fetchMyLedger });

  const me = meQuery.data;
  const clients = clientsQuery.data ?? [];
  const credit = me?.credit ?? 0;
  const activeCount = clients.filter(
    (c) => c.enable && expiryState(c.expiryTime).kind !== 'expired',
  ).length;
  const inboundOptions = useMemo(
    () =>
      (me?.inbounds ?? []).map((ib) => ({
        value: ib.id,
        label: `${ib.remark || `#${ib.id}`} (${ib.protocol}:${ib.port})`,
      })),
    [me?.inbounds],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [renewFor, setRenewFor] = useState<ClientView | null>(null);
  const [renewDays, setRenewDays] = useState<number | null>(30);
  const [editFor, setEditFor] = useState<ClientView | null>(null);
  const [linksFor, setLinksFor] = useState<ClientView | null>(null);

  const addForm = useZodForm(NewClientSchema, {
    defaultValues: {
      email: '',
      days: 30,
      inboundIds: [],
      trafficLimitGB: 0,
      limitIp: 0,
      comment: '',
      tgId: 0,
      startOnFirstUse: false,
    },
  });
  const editForm = useZodForm(EditClientSchema, {
    defaultValues: { enable: true, trafficLimitGB: 0, limitIp: 0, comment: '', tgId: 0 },
  });
  const addDays = addForm.watch('days') || 0;

  const linksQuery = useQuery({
    queryKey: ['ovix', 'links', linksFor?.email ?? ''],
    queryFn: () => fetchMyClientLinks(linksFor?.email ?? ''),
    enabled: linksFor !== null,
  });

  const addMut = useMutation({
    mutationFn: (v: NewClientValues) => ovixApi.addClient(v),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellerPortal.created'));
      setAddOpen(false);
      refresh();
    },
  });
  const renewMut = useMutation({
    mutationFn: ({ email, days }: { email: string; days: number }) =>
      ovixApi.renewClient(email, days),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellerPortal.renewed'));
      setRenewFor(null);
      refresh();
    },
  });
  const editMut = useMutation({
    mutationFn: ({ email, v }: { email: string; v: EditClientValues }) =>
      ovixApi.updateClient(email, v),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellerPortal.saved'));
      setEditFor(null);
      refresh();
    },
  });

  function openAdd() {
    addForm.reset({
      email: '',
      days: 30,
      inboundIds: inboundOptions.length === 1 ? [inboundOptions[0].value] : [],
      trafficLimitGB: 0,
      limitIp: 0,
      comment: '',
      tgId: 0,
      startOnFirstUse: false,
    });
    setAddOpen(true);
  }

  function openEdit(c: ClientView) {
    editForm.reset({
      enable: c.enable,
      trafficLimitGB: Math.round(c.totalBytes / GB),
      limitIp: c.limitIp,
      comment: c.comment,
      tgId: c.tgId,
    });
    setEditFor(c);
  }

  function confirmReset(c: ClientView) {
    modal.confirm({
      title: t('pages.resellerPortal.resetTitle', { name: c.email }),
      okText: t('reset'),
      cancelText: t('cancel'),
      onOk: async () => {
        const msg = await ovixApi.resetClientTraffic(c.email);
        if (msg?.success) {
          messageApi.success(t('pages.resellerPortal.resetDone'));
          refresh();
        }
      },
    });
  }

  function confirmDelete(c: ClientView) {
    modal.confirm({
      title: t('pages.resellerPortal.deleteTitle', { name: c.email }),
      content: t('pages.resellerPortal.deleteContent'),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: async () => {
        const msg = await ovixApi.deleteClient(c.email);
        if (msg?.success) {
          messageApi.success(t('pages.resellerPortal.deleted'));
          refresh();
        }
      },
    });
  }

  async function logout() {
    await HttpUtil.post('/logout');
    window.location.href = window.X_UI_BASE_PATH || '/';
  }

  async function copy(text: string) {
    if (await ClipboardManager.copyText(text)) messageApi.success(t('copied'));
  }

  function rowActions(c: ClientView): MenuProps['items'] {
    return [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: t('pages.resellerPortal.edit'),
        onClick: () => openEdit(c),
      },
      {
        key: 'reset',
        icon: <RetweetOutlined />,
        label: t('pages.resellerPortal.resetTraffic'),
        onClick: () => confirmReset(c),
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t('delete'),
        danger: true,
        onClick: () => confirmDelete(c),
      },
    ];
  }

  function expiryCell(c: ClientView) {
    const s = expiryState(c.expiryTime);
    switch (s.kind) {
      case 'unlimited':
        return <Tag>{t('pages.resellerPortal.never')}</Tag>;
      case 'firstUse':
        return (
          <Tag color="blue">{t('pages.resellerPortal.startsOnFirstUse', { days: s.days })}</Tag>
        );
      case 'expired':
        return (
          <Tag color="red">
            {t('pages.resellerPortal.expiredOn', { date: formatDateTime(s.at) })}
          </Tag>
        );
      case 'active':
        return (
          <Space orientation="vertical" size={0}>
            <Tag color={s.daysLeft <= 3 ? 'orange' : 'green'}>
              {t('pages.resellerPortal.daysLeft', { days: s.daysLeft })}
            </Tag>
            <small>{formatDateTime(s.at)}</small>
          </Space>
        );
    }
  }

  const columns: TableColumnsType<ClientView> = [
    {
      title: t('pages.resellerPortal.client'),
      dataIndex: 'email',
      key: 'email',
      render: (email: string, c) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <strong>{email}</strong>
            {!c.enable && <Tag color="default">{t('pages.resellerPortal.off')}</Tag>}
          </Space>
          {c.comment && <small>{c.comment}</small>}
        </Space>
      ),
    },
    {
      title: t('pages.resellerPortal.expiry'),
      dataIndex: 'expiryTime',
      key: 'expiryTime',
      width: 200,
      render: (_v, c) => expiryCell(c),
    },
    {
      title: t('pages.resellerPortal.traffic'),
      key: 'traffic',
      width: 200,
      render: (_v, c) => (
        <span>
          {SizeFormatter.sizeFormat(c.up + c.down)}
          {' / '}
          {c.totalBytes > 0 ? SizeFormatter.sizeFormat(c.totalBytes) : 'âˆž'}
        </span>
      ),
    },
    {
      title: t('pages.resellerPortal.ipLimit'),
      dataIndex: 'limitIp',
      key: 'limitIp',
      width: 90,
      render: (n: number) => (n > 0 ? n : 'âˆž'),
    },
    {
      title: t('pages.clients.actions'),
      key: 'actions',
      width: 170,
      render: (_v, c) => (
        <Space size={2}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<CalendarOutlined />}
            disabled={c.expiryTime === 0}
            onClick={() => {
              setRenewDays(30);
              setRenewFor(c);
            }}
          >
            {t('pages.resellerPortal.renew')}
          </Button>
          <Button
            size="small"
            type="text"
            aria-label={t('pages.resellerPortal.links')}
            icon={<LinkOutlined />}
            onClick={() => setLinksFor(c)}
          />
          <Dropdown trigger={['click']} menu={{ items: rowActions(c) }}>
            <Button size="small" type="text" aria-label={t('more')} icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  const ledgerColumns: TableColumnsType<LedgerRow> = [
    {
      title: t('pages.resellers.when'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (ms: number) => formatDateTime(ms),
    },
    {
      title: t('pages.resellers.reason'),
      dataIndex: 'reason',
      key: 'reason',
      render: (r: string) => reasonLabel(t, r),
    },
    {
      title: t('pages.resellers.change'),
      dataIndex: 'delta',
      key: 'delta',
      render: (d: number) => (d > 0 ? `+${d}` : d),
    },
    { title: t('pages.resellers.balance'), dataIndex: 'balanceAfter', key: 'balanceAfter' },
    { title: t('pages.resellers.client'), dataIndex: 'clientEmail', key: 'clientEmail' },
  ];

  const pageClass = ['reseller-portal', isDark && 'is-dark', isUltra && 'is-ultra']
    .filter(Boolean)
    .join(' ');
  const renewCost = renewDays ?? 0;

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      {modalContextHolder}
      <Layout className={pageClass}>
        <header className="portal-header">
          <span className="portal-brand">Ovix UI</span>
          <Space size={8}>
            {me && !isMobile && <span>{me.username}</span>}
            <Button
              shape="circle"
              aria-label={t('menu.theme')}
              icon={isDark ? <MoonOutlined /> : <SunOutlined />}
              onClick={toggleTheme}
            />
            <Button icon={<LogoutOutlined />} onClick={logout}>
              {!isMobile && t('logout')}
            </Button>
          </Space>
        </header>
        <Layout.Content className="portal-content">
          {meQuery.isError ? (
            <Result
              status="error"
              title={t('somethingWentWrong')}
              subTitle={(meQuery.error as Error).message}
              extra={
                <Button type="primary" onClick={() => meQuery.refetch()}>
                  {t('refresh')}
                </Button>
              }
            />
          ) : !me ? (
            <Spin size="large" style={{ display: 'block', marginTop: 80 }} />
          ) : (
            <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
              <Col span={24}>
                <Card size="small" className="summary-card">
                  <Row gutter={[16, 12]}>
                    <Col xs={12} md={8}>
                      <Statistic
                        title={t('pages.resellerPortal.credit')}
                        value={credit}
                        prefix={<DollarOutlined />}
                        suffix={t('pages.resellerPortal.days')}
                      />
                    </Col>
                    <Col xs={12} md={8}>
                      <Statistic
                        title={t('pages.resellerPortal.clients')}
                        value={clients.length}
                        prefix={<TeamOutlined />}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Statistic
                        title={t('pages.resellerPortal.activeClients')}
                        value={activeCount}
                      />
                    </Col>
                  </Row>
                </Card>
              </Col>
              {me.inbounds.length === 0 && (
                <Col span={24}>
                  <Alert type="warning" showIcon title={t('pages.resellerPortal.noInbounds')} />
                </Col>
              )}
              <Col span={24}>
                <Card size="small">
                  <Tabs
                    items={[
                      {
                        key: 'clients',
                        label: t('pages.resellerPortal.clients'),
                        children: (
                          <>
                            <div className="card-toolbar" style={{ marginBottom: 12 }}>
                              <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                disabled={me.inbounds.length === 0 || credit < 1}
                                onClick={openAdd}
                              >
                                {t('pages.resellerPortal.add')}
                              </Button>
                            </div>
                            <Table<ClientView>
                              dataSource={clients}
                              columns={columns}
                              rowKey="email"
                              size="small"
                              loading={clientsQuery.isLoading}
                              scroll={{ x: 760 }}
                              locale={{ emptyText: t('pages.resellerPortal.empty') }}
                            />
                          </>
                        ),
                      },
                      {
                        key: 'ledger',
                        label: t('pages.resellerPortal.history'),
                        children: (
                          <Table<LedgerRow>
                            dataSource={ledgerQuery.data ?? []}
                            columns={ledgerColumns}
                            rowKey="id"
                            size="small"
                            loading={ledgerQuery.isFetching}
                            scroll={{ x: 600 }}
                          />
                        ),
                      },
                    ]}
                  />
                </Card>
              </Col>
            </Row>
          )}
          <Credit className="is-center" />
        </Layout.Content>

        <Modal
          open={addOpen}
          title={t('pages.resellerPortal.add')}
          okText={t('pages.resellerPortal.createFor', { credit: addDays })}
          cancelText={t('cancel')}
          confirmLoading={addMut.isPending}
          okButtonProps={{ disabled: addDays > credit }}
          onCancel={() => setAddOpen(false)}
          onOk={addForm.handleSubmit((v) => addMut.mutate(v))}
          destroyOnHidden
        >
          <FormProvider {...addForm}>
            <Form layout="vertical">
              <FormField name="email" label={t('pages.resellerPortal.clientName')} required>
                <Input autoComplete="off" autoFocus />
              </FormField>
              <FormField
                name="days"
                label={t('pages.resellerPortal.daysLabel')}
                extra={t('pages.resellerPortal.costHint', { cost: addDays, credit })}
                transform={intInput}
                required
              >
                <InputNumber min={1} max={MAX_DAYS} precision={0} style={{ width: '100%' }} />
              </FormField>
              <FormField name="inboundIds" label={t('pages.resellers.inbounds')} required>
                <Select mode="multiple" options={inboundOptions} />
              </FormField>
              <Row gutter={12}>
                <Col span={12}>
                  <FormField
                    name="trafficLimitGB"
                    label={t('pages.resellerPortal.trafficLimitGB')}
                    extra={t('pages.resellerPortal.zeroUnlimited')}
                    transform={intInput}
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                  </FormField>
                </Col>
                <Col span={12}>
                  <FormField
                    name="limitIp"
                    label={t('pages.resellerPortal.ipLimit')}
                    extra={t('pages.resellerPortal.zeroUnlimited')}
                    transform={intInput}
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                  </FormField>
                </Col>
              </Row>
              <FormField name="comment" label={t('pages.resellerPortal.comment')}>
                <Input />
              </FormField>
              <FormField
                name="startOnFirstUse"
                label={t('pages.resellerPortal.startOnFirstUse')}
                extra={t('pages.resellerPortal.startOnFirstUseHint')}
                valueProp="checked"
              >
                <Switch />
              </FormField>
            </Form>
          </FormProvider>
        </Modal>

        <Modal
          open={renewFor !== null}
          title={t('pages.resellerPortal.renewTitle', { name: renewFor?.email ?? '' })}
          okText={t('pages.resellerPortal.renewFor', { credit: renewCost })}
          cancelText={t('cancel')}
          confirmLoading={renewMut.isPending}
          okButtonProps={{ disabled: renewCost < 1 || renewCost > credit }}
          onCancel={() => setRenewFor(null)}
          onOk={() => renewFor && renewMut.mutate({ email: renewFor.email, days: renewCost })}
          destroyOnHidden
        >
          <Form layout="vertical">
            <Form.Item
              label={t('pages.resellerPortal.daysLabel')}
              extra={t('pages.resellerPortal.costHint', { cost: renewCost, credit })}
            >
              <InputNumber
                value={renewDays}
                min={1}
                max={MAX_DAYS}
                precision={0}
                onChange={(v) => setRenewDays(v)}
                style={{ width: '100%' }}
                autoFocus
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={editFor !== null}
          title={t('pages.resellerPortal.editTitle', { name: editFor?.email ?? '' })}
          okText={t('save')}
          cancelText={t('cancel')}
          confirmLoading={editMut.isPending}
          onCancel={() => setEditFor(null)}
          onOk={editForm.handleSubmit(
            (v) => editFor && editMut.mutate({ email: editFor.email, v }),
          )}
          destroyOnHidden
        >
          <FormProvider {...editForm}>
            <Form layout="vertical">
              <FormField
                name="enable"
                label={t('pages.resellerPortal.enabled')}
                valueProp="checked"
              >
                <Switch />
              </FormField>
              <Row gutter={12}>
                <Col span={12}>
                  <FormField
                    name="trafficLimitGB"
                    label={t('pages.resellerPortal.trafficLimitGB')}
                    extra={t('pages.resellerPortal.zeroUnlimited')}
                    transform={intInput}
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                  </FormField>
                </Col>
                <Col span={12}>
                  <FormField
                    name="limitIp"
                    label={t('pages.resellerPortal.ipLimit')}
                    extra={t('pages.resellerPortal.zeroUnlimited')}
                    transform={intInput}
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                  </FormField>
                </Col>
              </Row>
              <FormField name="comment" label={t('pages.resellerPortal.comment')}>
                <Input />
              </FormField>
              <FormField
                name="tgId"
                label={t('pages.resellerPortal.telegramId')}
                transform={intInput}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </FormField>
            </Form>
          </FormProvider>
        </Modal>

        <Modal
          open={linksFor !== null}
          title={t('pages.resellerPortal.linksTitle', { name: linksFor?.email ?? '' })}
          footer={null}
          width={720}
          onCancel={() => setLinksFor(null)}
          destroyOnHidden
        >
          <Spin spinning={linksQuery.isFetching}>
            {(['subscription', 'links'] as const).map((group) => (
              <div key={group} style={{ marginBottom: 16 }}>
                <h4>
                  {group === 'subscription'
                    ? t('pages.resellerPortal.subscriptionLink')
                    : t('pages.resellerPortal.shareLinks')}
                </h4>
                {(linksQuery.data?.[group] ?? []).map((link) => (
                  <div key={link} className="link-row">
                    <code>{link}</code>
                    <Button
                      size="small"
                      aria-label={t('copied')}
                      icon={<CopyOutlined />}
                      onClick={() => copy(link)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </Spin>
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}
