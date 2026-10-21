-- 设计草案：仅用于新的空 PostgreSQL 测试数据库。尚未执行数据库验收。
-- UUID 由服务端生成；金额单位为分；timestamp 使用 timestamptz。
-- 迁移不包含认证/RLS/支付任务。生产应用角色不得拥有 schema/table/trigger。
BEGIN;
CREATE SCHEMA siyue;
SET search_path = siyue, public;

CREATE DOMAIN money_minor AS bigint CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE campuses (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE employees (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 home_campus_id uuid, kind text NOT NULL CHECK(kind IN ('teacher','staff','both')),
 status text NOT NULL CHECK(status IN ('active','inactive')), profile_ciphertext bytea,
 version bigint NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,home_campus_id) REFERENCES campuses(tenant_id,id)
);
CREATE TABLE accounts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, employee_id uuid,
 login_subject text NOT NULL, active boolean NOT NULL DEFAULT true, is_superadmin boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,login_subject),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE roles (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE role_permissions (
 tenant_id uuid NOT NULL, role_id uuid NOT NULL, operation_id text NOT NULL,
 field_access jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(field_access)='object'),
 PRIMARY KEY(tenant_id,role_id,operation_id), FOREIGN KEY(tenant_id,role_id) REFERENCES roles(tenant_id,id)
);
CREATE TABLE account_roles (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, role_id uuid NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN ('own','campuses','tenant')),
 PRIMARY KEY(tenant_id,account_id,role_id), FOREIGN KEY(tenant_id,account_id) REFERENCES accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,role_id) REFERENCES roles(tenant_id,id)
);
CREATE TABLE account_role_campuses (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, role_id uuid NOT NULL, campus_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,account_id,role_id,campus_id),
 FOREIGN KEY(tenant_id,account_id,role_id) REFERENCES account_roles(tenant_id,account_id,role_id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id)
);
CREATE TABLE students (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 birthday date, contact_ciphertext bytea, contact_lookup_hash text,
 status text NOT NULL CHECK(status IN ('prospect','active','historical')),
 version bigint NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(tenant_id,id)
);
CREATE INDEX student_contact_lookup ON students(tenant_id,contact_lookup_hash);
-- 联系人哈希不唯一：兄弟姐妹可共享家长号码。档案合并需显式业务操作。
CREATE TABLE leads (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, student_id uuid, campus_id uuid,
 registrant_id uuid, owner_id uuid, source_kind text NOT NULL, source_ref text, name text NOT NULL,
 contact_ciphertext bytea, stage text NOT NULL, intent text CHECK(intent IN ('high','medium','low','unknown')),
 retained_until timestamptz, next_follow_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,registrant_id) REFERENCES accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES accounts(tenant_id,id)
);
CREATE TABLE lead_events (
 tenant_id uuid NOT NULL, id uuid NOT NULL, lead_id uuid NOT NULL, actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('registered','retained','assigned','transferred','released','reclaimed','followed','converted')),
 previous_owner_id uuid, next_owner_id uuid, note text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,previous_owner_id) REFERENCES accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,next_owner_id) REFERENCES accounts(tenant_id,id)
);
CREATE TABLE policy_versions (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, kind text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'), state text NOT NULL CHECK(state IN ('draft','published','retired')),
 published_at timestamptz, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,kind,revision)
);

CREATE TABLE courses (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 subject text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE course_versions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('draft','published','retired')), title text NOT NULL,
 age_min integer CHECK(age_min>=0), age_max integer, price_minor money_minor NOT NULL,
 materials jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(materials)='array'),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,course_id,revision),
 CHECK(age_max IS NULL OR age_max>=age_min), FOREIGN KEY(tenant_id,course_id) REFERENCES courses(tenant_id,id)
);
CREATE TABLE lessons (
 tenant_id uuid NOT NULL, id uuid NOT NULL, course_version_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0),
 title text NOT NULL, content jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,course_version_id,ordinal), UNIQUE(tenant_id,course_version_id,id),
 FOREIGN KEY(tenant_id,course_version_id) REFERENCES course_versions(tenant_id,id)
);
CREATE TABLE rooms (
 tenant_id uuid NOT NULL, id uuid NOT NULL, campus_id uuid NOT NULL, name text NOT NULL, capacity integer NOT NULL CHECK(capacity>0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campus_id,id), FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id)
);
CREATE TABLE classes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL, campus_id uuid NOT NULL, course_version_id uuid NOT NULL,
 teacher_id uuid NOT NULL, capacity integer NOT NULL CHECK(capacity>0), state text NOT NULL CHECK(state IN ('planned','active','completed','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,id,course_version_id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,course_version_id) REFERENCES course_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,teacher_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE class_sessions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, class_id uuid NOT NULL, course_version_id uuid NOT NULL, lesson_id uuid NOT NULL,
 campus_id uuid NOT NULL, room_id uuid, actual_teacher_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('scheduled','recorded','cancelled')), teaching_record jsonb NOT NULL DEFAULT '{}',
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id), CHECK(ends_at>starts_at),
 FOREIGN KEY(tenant_id,class_id,course_version_id) REFERENCES classes(tenant_id,id,course_version_id),
 FOREIGN KEY(tenant_id,course_version_id,lesson_id) REFERENCES lessons(tenant_id,course_version_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,room_id) REFERENCES rooms(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,actual_teacher_id) REFERENCES employees(tenant_id,id)
);
CREATE INDEX session_teacher_time ON class_sessions(tenant_id,actual_teacher_id,starts_at,ends_at);
CREATE INDEX session_room_time ON class_sessions(tenant_id,room_id,starts_at,ends_at);
-- 冲突检查与容量检查须在操作事务中锁定相关资源；仅靠上面索引不能防止并发超排。

CREATE TABLE promotions (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
 template text NOT NULL CHECK(template IN ('referral','pair','renewal','custom')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE promotion_versions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, promotion_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('draft','published','retired')), rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,promotion_id,revision), CHECK(ends_at>starts_at),
 FOREIGN KEY(tenant_id,promotion_id) REFERENCES promotions(tenant_id,id)
);
CREATE TABLE product_versions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, course_version_id uuid NOT NULL, title text NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','published','retired')), detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'),
 price_minor money_minor NOT NULL, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,course_version_id) REFERENCES course_versions(tenant_id,id)
);
CREATE TABLE orders (
 tenant_id uuid NOT NULL, id uuid NOT NULL, order_number text NOT NULL, student_id uuid NOT NULL, campus_id uuid NOT NULL,
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'), gross_minor money_minor NOT NULL,
 discount_minor money_minor NOT NULL DEFAULT 0, total_minor money_minor NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','part_paid','paid','cancelled','closed')),
 pricing_snapshot jsonb NOT NULL CHECK(jsonb_typeof(pricing_snapshot)='object'),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,order_number), CHECK(discount_minor<=gross_minor), CHECK(total_minor=gross_minor-discount_minor),
 FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id), FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id)
);
CREATE TABLE order_lines (
 tenant_id uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL, course_version_id uuid NOT NULL, promotion_version_id uuid,
 amount_minor money_minor NOT NULL, lesson_allocation jsonb NOT NULL CHECK(jsonb_typeof(lesson_allocation)='array'),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),
 FOREIGN KEY(tenant_id,course_version_id) REFERENCES course_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,promotion_version_id) REFERENCES promotion_versions(tenant_id,id)
);
CREATE TABLE enrollments (
 tenant_id uuid NOT NULL, id uuid NOT NULL, student_id uuid NOT NULL, course_version_id uuid NOT NULL, order_line_id uuid,
 status text NOT NULL CHECK(status IN ('pending_payment','active','withdrawn','completed')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
 FOREIGN KEY(tenant_id,course_version_id) REFERENCES course_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,order_line_id) REFERENCES order_lines(tenant_id,id)
);
CREATE UNIQUE INDEX one_entitlement_per_line ON enrollments(tenant_id,order_line_id) WHERE order_line_id IS NOT NULL;
CREATE TABLE enrollment_classes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, enrollment_id uuid NOT NULL, class_id uuid NOT NULL,
 effective_from timestamptz NOT NULL, effective_until timestamptz, reason text,
 PRIMARY KEY(tenant_id,id), CHECK(effective_until IS NULL OR effective_until>effective_from),
 FOREIGN KEY(tenant_id,enrollment_id) REFERENCES enrollments(tenant_id,id), FOREIGN KEY(tenant_id,class_id) REFERENCES classes(tenant_id,id)
);
CREATE UNIQUE INDEX one_current_class ON enrollment_classes(tenant_id,enrollment_id) WHERE effective_until IS NULL;
-- 历史区间不重叠、讲次等价、订单学生一致性在领域处理器校验；草案不声称外键已覆盖这些跨表规则。
CREATE TABLE session_roster (
 tenant_id uuid NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL, enrollment_id uuid NOT NULL,
 source_session_id uuid, status text NOT NULL CHECK(status IN ('scheduled','attended','absent','cancelled')),
 reason text, version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,session_id,enrollment_id), FOREIGN KEY(tenant_id,session_id) REFERENCES class_sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,source_session_id) REFERENCES class_sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,enrollment_id) REFERENCES enrollments(tenant_id,id)
);
CREATE TABLE consumption_entries (
 tenant_id uuid NOT NULL, id uuid NOT NULL, request_id uuid NOT NULL, roster_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('confirm','reverse')),
 amount_minor money_minor NOT NULL, confirmed_by uuid NOT NULL, reverses_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,reverses_id), UNIQUE(tenant_id,request_id,roster_id,kind),
 CHECK((kind='reverse')=(reverses_id IS NOT NULL)), FOREIGN KEY(tenant_id,roster_id) REFERENCES session_roster(tenant_id,id),
 FOREIGN KEY(tenant_id,confirmed_by) REFERENCES accounts(tenant_id,id), FOREIGN KEY(tenant_id,reverses_id) REFERENCES consumption_entries(tenant_id,id)
);
-- 确认前锁定 roster，保证最多一个未冲正确认；冲正后允许新请求再次确认。
-- 冲正金额与原确认相等、禁止冲正别的 roster 或冲正事件，由处理器复核。

CREATE TABLE payment_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, channel text NOT NULL,
 provider_transaction_id text NOT NULL, amount_minor money_minor NOT NULL, verified_at timestamptz NOT NULL,
 evidence_ref text NOT NULL, confirmed_by uuid, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,channel,provider_transaction_id),
 FOREIGN KEY(tenant_id,confirmed_by) REFERENCES accounts(tenant_id,id)
);
CREATE TABLE payment_allocations (
 tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, order_id uuid NOT NULL, amount_minor money_minor NOT NULL CHECK(amount_minor>0),
 PRIMARY KEY(tenant_id,receipt_id,order_id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES payment_receipts(tenant_id,id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE TABLE withdrawals (
 tenant_id uuid NOT NULL, id uuid NOT NULL, enrollment_id uuid NOT NULL, calculation text NOT NULL CHECK(calculation IN ('automatic','manual')),
 refund_minor money_minor NOT NULL, basis jsonb NOT NULL CHECK(jsonb_typeof(basis)='object'), reason text NOT NULL,
 effective_at timestamptz NOT NULL, requested_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,enrollment_id), FOREIGN KEY(tenant_id,enrollment_id) REFERENCES enrollments(tenant_id,id),
 FOREIGN KEY(tenant_id,requested_by) REFERENCES accounts(tenant_id,id)
);
CREATE TABLE refunds (
 tenant_id uuid NOT NULL, id uuid NOT NULL, withdrawal_id uuid NOT NULL, amount_minor money_minor NOT NULL,
 status text NOT NULL CHECK(status IN ('submitted','approved','processing','succeeded','failed','rejected')),
 approved_by uuid, provider_refund_id text, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,withdrawal_id) REFERENCES withdrawals(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES accounts(tenant_id,id)
);
CREATE TABLE refund_allocations (
 tenant_id uuid NOT NULL, refund_id uuid NOT NULL, receipt_id uuid NOT NULL, order_id uuid NOT NULL,
 amount_minor money_minor NOT NULL CHECK(amount_minor>0), PRIMARY KEY(tenant_id,refund_id,receipt_id,order_id),
 FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
 FOREIGN KEY(tenant_id,receipt_id,order_id) REFERENCES payment_allocations(tenant_id,receipt_id,order_id)
);
-- 分摊总和、退款预占上限、订单余额必须锁行并在同一事务核验，不能只依赖 CHECK。
CREATE TABLE money_entries (
 tenant_id uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('receipt','refund','reversal')),
 amount_minor money_minor NOT NULL CHECK(amount_minor>0), direction smallint NOT NULL CHECK(direction IN (-1,1)),
 receipt_id uuid, refund_id uuid, reverses_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,reverses_id),
 CHECK((kind='receipt' AND receipt_id IS NOT NULL AND refund_id IS NULL AND reverses_id IS NULL AND direction=1)
    OR (kind='refund' AND refund_id IS NOT NULL AND reverses_id IS NULL AND direction=-1)
    OR (kind='reversal' AND reverses_id IS NOT NULL)),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES payment_receipts(tenant_id,id),
 FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,reverses_id) REFERENCES money_entries(tenant_id,id)
);
CREATE UNIQUE INDEX one_receipt_entry_per_order ON money_entries(tenant_id,order_id,receipt_id) WHERE kind='receipt';
CREATE UNIQUE INDEX one_refund_entry_per_order ON money_entries(tenant_id,order_id,refund_id) WHERE kind='refund';

CREATE TABLE operation_requests (
 tenant_id uuid NOT NULL, id uuid NOT NULL, actor_id uuid NOT NULL, operation_id text NOT NULL, idempotency_key text NOT NULL,
 request_hash text NOT NULL, state text NOT NULL CHECK(state IN ('processing','succeeded','failed')),
 response jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,actor_id,operation_id,idempotency_key), FOREIGN KEY(tenant_id,actor_id) REFERENCES accounts(tenant_id,id)
);
ALTER TABLE consumption_entries ADD FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id);
CREATE TABLE audit_events (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, request_id uuid, actor_id uuid,
 campus_id uuid, source text NOT NULL CHECK(source IN ('page','search','cli','agent','webhook','job')),
 category text NOT NULL, operation_id text NOT NULL, object_type text, object_id uuid,
 result text NOT NULL CHECK(result IN ('succeeded','failed','denied','viewed')), reason text,
 redacted_diff jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(redacted_diff)='array'), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES accounts(tenant_id,id), FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id)
);
CREATE INDEX audit_actor_time ON audit_events(tenant_id,actor_id,created_at DESC);
CREATE INDEX audit_category_time ON audit_events(tenant_id,category,result,created_at DESC);
CREATE INDEX audit_object_time ON audit_events(tenant_id,object_type,object_id,created_at DESC);
CREATE TABLE outbox_events (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, request_id uuid NOT NULL,
 event_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_version bigint NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,request_id) REFERENCES operation_requests(tenant_id,id)
);
CREATE INDEX outbox_pending ON outbox_events(next_attempt_at) WHERE published_at IS NULL;
CREATE TABLE webhook_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), provider text NOT NULL, event_id text NOT NULL,
 payload_hash text NOT NULL, verified_at timestamptz NOT NULL, processed_at timestamptz,
 PRIMARY KEY(tenant_id,provider,event_id)
);
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only history: use a compensating event'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER money_append_only BEFORE UPDATE OR DELETE ON money_entries FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER consumption_append_only BEFORE UPDATE OR DELETE ON consumption_entries FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER lead_history_append_only BEFORE UPDATE OR DELETE ON lead_events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON payment_receipts FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
-- REVOKE/GRANT、RLS、只追加外部备份须由部署迁移配置；本草案不创建高权限运行账号。
COMMIT;
