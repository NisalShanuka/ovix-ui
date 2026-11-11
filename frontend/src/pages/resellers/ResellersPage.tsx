import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  HistoryOutlined,
  KeyOutlined,
  PlusOutlined,
  ShopOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';

import { useTheme } from '@/hooks/useTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useInboundOptions } from '@/api/queries/useInboundOptions';
import { setMessageInstance } from '@/utils/messageBus';
import AppSidebar from '@/layouts/AppSidebar';
import PageTop from '@/ds/PageTop';
import { FormField, useZodForm } from '@/components/form/rhf';
import {
  fetchAudit,
  fetchLedger,
  fetchResellers,
  ovixApi,
  ovixKeys,
  type AuditRow,
  type LedgerRow,
  type ResellerView,
} from '@/api/ovix';
import { formatDateTime, reasonLabel } from './format';
import './resellers.css';

const ResellerFormSchema = z.object({
  username: z.string().trim().min(1, 'pages.resellers.usernameRequired').max(64),
  password: z.string().min(8, 'pages.resellers.passwordTooShort'),
  note: z.string(),
  inboundIds: z.array(z.number().int()),
});
type ResellerFormValues = z.infer<typeof ResellerFormSchema>;

const EditFormSchema = z.object({
  note: z.string(),
  disabled: z.boolean(),
  inboundIds: z.array(z.number().int()),
});
type EditFormValues = z.infer<typeof EditFormSchema>;

export default function ResellersPage() {
  usePageTitle();
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const [modal, modalContextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ovixKeys.root() });

  const resellersQuery = useQuery({ queryKey: ovixKeys.resellers(), queryFn: fetchResellers });
  const auditQuery = useQuery({ queryKey: ovixKeys.audit(), queryFn: fetchAudit });
  const inboundsQuery = useInboundOptions();
  const inboundOptions = useMemo(
    () =>
      (inboundsQuery.data ?? []).map((ib) => ({
        value: ib.id,
        label: `${ib.remark || ib.tag} (${ib.protocol}:${ib.port})`,
      })),
    [inboundsQuery.data],
  );
  const inboundName = useMemo(() => {
    const m = new Map<number, string>();
    (inboundsQuery.data ?? []).forEach((ib) => m.set(ib.id, ib.remark || ib.tag || `#${ib.id}`));
    return m;
  }, [inboundsQuery.data]);

  const resellers = resellersQuery.data ?? [];
  const totalCredit = resellers.reduce((acc, r) => acc + r.credit, 0);
  const totalClients = resellers.reduce((acc, r) => acc + r.clientCount, 0);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ResellerView | null>(null);
  const [creditFor, setCreditFor] = useState<ResellerView | null>(null);
  const [creditDelta, setCreditDelta] = useState<number | null>(30);
  const [passwordFor, setPasswordFor] = useState<ResellerView | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [ledgerFor, setLedgerFor] = useState<ResellerView | null>(null);

  const addForm = useZodForm(ResellerFormSchema, {
    defaultValues: { username: '', password: '', note: '', inboundIds: [] },
  });
  const editForm = useZodForm(EditFormSchema, {
    defaultValues: { note: '', disabled: false, inboundIds: [] },
  });

  const ledgerQuery = useQuery({
    queryKey: ovixKeys.ledger(ledgerFor?.userId ?? 0),
    queryFn: () => fetchLedger(ledgerFor?.userId ?? 0),
    enabled: ledgerFor !== null,
  });

  const addMut = useMutation({
    mutationFn: (v: ResellerFormValues) => ovixApi.addReseller(v),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellers.created'));
      setAddOpen(false);
      addForm.reset();
      refresh();
    },
  });
  const editMut = useMutation({
    mutationFn: ({ id, v }: { id: number; v: EditFormValues }) => ovixApi.updateReseller(id, v),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellers.saved'));
      setEditing(null);
      refresh();
    },
  });
  const creditMut = useMutation({
    mutationFn: ({ id, delta }: { id: number; delta: number }) => ovixApi.addCredit(id, delta),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellers.creditSaved'));
      setCreditFor(null);
      refresh();
    },
  });
  const passwordMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      ovixApi.setPassword(id, password),
    onSuccess: (msg) => {
      if (!msg?.success) return;
      messageApi.success(t('pages.resellers.passwordSaved'));
      setPasswordFor(null);
      refresh();
    },
  });

  function openEdit(r: ResellerView) {
    editForm.reset({ note: r.note, disabled: r.disabled, inboundIds: r.inboundIds });
    setEditing(r);
  }

  function confirmDelete(r: ResellerView) {
    modal.confirm({
      title: t('pages.resellers.deleteTitle', { name: r.username }),
      content: t('pages.resellers.deleteContent'),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: async () => {
        const msg = await ovixApi.deleteReseller(r.userId);
        if (msg?.success) {
          messageApi.success(t('pages.resellers.deleted'));
          refresh();
        }
      },
    });
  }

  const columns: TableColumnsType<ResellerView> = [
    {
      title: t('pages.resellers.username'),
      dataIndex: 'username',
      key: 'username',
      render: (name: string, r) => (
        <Space size={6}>
          <span>{name}</span>
          {r.disabled ? (
            <Tag color="red">{t('pages.resellers.disabled')}</Tag>
          ) : (
            <Tag color="green">{t('pages.resellers.active')}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('pages.resellers.credit'),
      dataIndex: 'credit',
      key: 'credit',
      width: 120,
      render: (credit: number) => <strong>{credit}</strong>,
    },
    {
      title: t('pages.resellers.clients'),
      dataIndex: 'clientCount',
      key: 'clientCount',
      width: 100,
    },
    {
      title: t('pages.resellers.inbounds'),
      dataIndex: 'inboundIds',
      key: 'inboundIds',
      render: (ids: number[]) =>
        ids.length === 0 ? (
          <span>{t('pages.resellers.noInbounds')}</span>
        ) : (
          ids.map((id) => <Tag key={id}>{inboundName.get(id) ?? `#${id}`}</Tag>)
        ),
    },
    { title: t('pages.resellers.note'), dataIndex: 'note', key: 'note' },
    {
      title: t('pages.clients.actions'),
      key: 'actions',
      width: 190,
      render: (_v, r) => (
        <Space size={2}>
          <Tooltip title={t('pages.resellers.addCredit')}>
            <Button
              size="small"
              type="text"
              aria-label={t('pages.resellers.addCredit')}
              icon={<DollarOutlined />}
              onClick={() => {
                setCreditDelta(30);
                setCreditFor(r);
              }}
            />
          </Tooltip>
          <Tooltip title={t('pages.resellers.edit')}>
            <Button
              size="small"
              type="text"
              aria-label={t('pages.resellers.edit')}
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>
          <Tooltip title={t('pages.resellers.changePassword')}>
            <Button
              size="small"
              type="text"
              aria-label={t('pages.resellers.changePassword')}
              icon={<KeyOutlined />}
              onClick={() => {
                setNewPassword('');
                setPasswordFor(r);
              }}
            />
          </Tooltip>
          <Tooltip title={t('pages.resellers.ledger')}>
            <Button
              size="small"
              type="text"
              aria-label={t('pages.resellers.ledger')}
              icon={<HistoryOutlined />}
              onClick={() => setLedgerFor(r)}
            />
          </Tooltip>
          <Tooltip title={t('delete')}>
            <Button
              size="small"
              type="text"
              danger
              aria-label={t('delete')}
              icon={<DeleteOutlined />}
              onClick={() => confirmDelete(r)}
            />
          </Tooltip>
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
      render: (reason: string) => reasonLabel(t, reason),
    },
    {
      title: t('pages.resellers.change'),
      dataIndex: 'delta',
      key: 'delta',
      render: (d: number) => (
        <span style={{ color: d < 0 ? 'var(--ant-color-error)' : 'var(--ant-color-success)' }}>
          {d > 0 ? `+${d}` : d}
        </span>
      ),
    },
    { title: t('pages.resellers.balance'), dataIndex: 'balanceAfter', key: 'balanceAfter' },
    { title: t('pages.resellers.client'), dataIndex: 'clientEmail', key: 'clientEmail' },
  ];

  const auditColumns: TableColumnsType<AuditRow> = [
    {
      title: t('pages.resellers.when'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (ms: number) => formatDateTime(ms),
    },
    {
      title: t('pages.resellers.who'),
      dataIndex: 'actorId',
      key: 'actorId',
      width: 140,
      render: (id: number) =>
        resellers.find((r) => r.userId === id)?.username ?? t('pages.resellers.owner'),
    },
    { title: t('pages.resellers.action'), dataIndex: 'action', key: 'action', width: 170 },
    { title: t('pages.resellers.target'), dataIndex: 'target', key: 'target', width: 160 },
    { title: t('pages.resellers.details'), dataIndex: 'detail', key: 'detail', ellipsis: true },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
  ];

  const pageClass = ['resellers-page', isDark && 'is-dark', isUltra && 'is-ultra']
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      {modalContextHolder}
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            <PageTop />
            {resellersQuery.isError ? (
              <Result
                status="error"
                title={t('somethingWentWrong')}
                subTitle={(resellersQuery.error as Error).message}
                extra={
                  <Button type="primary" onClick={() => resellersQuery.refetch()}>
                    {t('refresh')}
                  </Button>
                }
              />
            ) : (
              <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 12]}>
                <Col span={24}>
                  <Card size="small" className="summary-card">
                    <Row gutter={[16, 12]}>
                      <Col xs={12} md={8}>
                        <Statistic
                          title={t('pages.resellers.totalResellers')}
                          value={resellers.length}
                          prefix={<ShopOutlined />}
                        />
                      </Col>
                      <Col xs={12} md={8}>
                        <Statistic
                          title={t('pages.resellers.totalClients')}
                          value={totalClients}
                          prefix={<TeamOutlined />}
                        />
                      </Col>
                      <Col xs={24} md={8}>
                        <Statistic
                          title={t('pages.resellers.creditOutstanding')}
                          value={totalCredit}
                          prefix={<DollarOutlined />}
                        />
                      </Col>
                    </Row>
                  </Card>
                </Col>
                <Col span={24}>
                  <Card size="small">
                    <Tabs
                      items={[
                        {
                          key: 'resellers',
                          label: t('menu.resellers'),
                          children: (
                            <>
                              <div className="card-toolbar" style={{ marginBottom: 12 }}>
                                <Button
                                  type="primary"
                                  icon={<PlusOutlined />}
                                  onClick={() => setAddOpen(true)}
                                >
                                  {t('pages.resellers.add')}
                                </Button>
                              </div>
                              <Table<ResellerView>
                                dataSource={resellers}
                                columns={columns}
                                rowKey="userId"
                                size="small"
                                pagination={false}
                                loading={resellersQuery.isFetching}
                                scroll={{ x: 900 }}
                                locale={{ emptyText: t('pages.resellers.empty') }}
                              />
                            </>
                          ),
                        },
                        {
                          key: 'audit',
                          label: t('pages.resellers.auditLog'),
                          children: (
                            <Table<AuditRow>
                              dataSource={auditQuery.data ?? []}
                              columns={auditColumns}
                              rowKey="id"
                              size="small"
                              loading={auditQuery.isFetching}
                              scroll={{ x: 900 }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Card>
                </Col>
              </Row>
            )}
          </Layout.Content>
        </Layout>

        <Modal
          open={addOpen}
          title={t('pages.resellers.add')}
          okText={t('create')}
          cancelText={t('cancel')}
          confirmLoading={addMut.isPending}
          onCancel={() => setAddOpen(false)}
          onOk={addForm.handleSubmit((v) => addMut.mutate(v))}
          destroyOnHidden
        >
          <FormProvider {...addForm}>
            <Form layout="vertical">
              <FormField name="username" label={t('pages.resellers.username')} required>
                <Input autoComplete="off" />
              </FormField>
              <FormField name="password" label={t('password')} required>
                <Input.Password autoComplete="new-password" />
              </FormField>
              <FormField name="inboundIds" label={t('pages.resellers.inbounds')}>
                <Select mode="multiple" options={inboundOptions} />
              </FormField>
              <FormField name="note" label={t('pages.resellers.note')}>
                <Input />
              </FormField>
            </Form>
          </FormProvider>
        </Modal>

        <Modal
          open={editing !== null}
          title={t('pages.resellers.editTitle', { name: editing?.username ?? '' })}
          okText={t('save')}
          cancelText={t('cancel')}
          confirmLoading={editMut.isPending}
          onCancel={() => setEditing(null)}
          onOk={editForm.handleSubmit((v) => editing && editMut.mutate({ id: editing.userId, v }))}
          destroyOnHidden
        >
          <FormProvider {...editForm}>
            <Form layout="vertical">
              <FormField name="inboundIds" label={t('pages.resellers.inbounds')}>
                <Select mode="multiple" options={inboundOptions} />
              </FormField>
              <FormField name="note" label={t('pages.resellers.note')}>
                <Input />
              </FormField>
              <FormField
                name="disabled"
                label={t('pages.resellers.disableLogin')}
                extra={t('pages.resellers.disableHint')}
                valueProp="checked"
              >
                <Switch />
              </FormField>
            </Form>
          </FormProvider>
        </Modal>

        <Modal
          open={creditFor !== null}
          title={t('pages.resellers.creditTitle', { name: creditFor?.username ?? '' })}
          okText={t('save')}
          cancelText={t('cancel')}
          confirmLoading={creditMut.isPending}
          okButtonProps={{ disabled: !creditDelta }}
          onCancel={() => setCreditFor(null)}
          onOk={() =>
            creditFor &&
            creditDelta &&
            creditMut.mutate({ id: creditFor.userId, delta: creditDelta })
          }
          destroyOnHidden
        >
          <Form layout="vertical">
            <Form.Item
              label={t('pages.resellers.creditDelta')}
              extra={t('pages.resellers.creditHint', { credit: creditFor?.credit ?? 0 })}
            >
              <InputNumber
                value={creditDelta}
                onChange={(v) => setCreditDelta(v)}
                precision={0}
                style={{ width: '100%' }}
                autoFocus
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={passwordFor !== null}
          title={t('pages.resellers.passwordTitle', { name: passwordFor?.username ?? '' })}
          okText={t('save')}
          cancelText={t('cancel')}
          confirmLoading={passwordMut.isPending}
          okButtonProps={{ disabled: newPassword.length < 8 }}
          onCancel={() => setPasswordFor(null)}
          onOk={() =>
            passwordFor && passwordMut.mutate({ id: passwordFor.userId, password: newPassword })
          }
          destroyOnHidden
        >
          <Form layout="vertical">
            <Form.Item label={t('password')} extra={t('pages.resellers.passwordTooShort')}>
              <Input.Password
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={ledgerFor !== null}
          title={t('pages.resellers.ledgerTitle', { name: ledgerFor?.username ?? '' })}
          footer={null}
          width={760}
          onCancel={() => setLedgerFor(null)}
          destroyOnHidden
        >
          <Table<LedgerRow>
            dataSource={ledgerQuery.data ?? []}
            columns={ledgerColumns}
            rowKey="id"
            size="small"
            loading={ledgerQuery.isFetching}
            scroll={{ x: 600 }}
          />
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}
