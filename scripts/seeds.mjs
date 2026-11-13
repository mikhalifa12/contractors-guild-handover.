#!/usr/bin/env node
/**
 * Development seed data.
 *
 *   npm run db:seed              seed the demo contractor (skips if present)
 *   npm run db:seed -- --session also print a ready-to-use session cookie
 *
 * Everything here is obviously fake demo data: placeholder business details,
 * placeholder banking numbers and example customers. It exists so a developer
 * can see the dashboard with real rows in it, and it is written through the
 * application role so the same row level security policies the app uses are
 * exercised.
 *
 * The script refuses to touch anything that is not a local database, and
 * refuses to run with NODE_ENV=production.
 */
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { Client } from 'pg';
import { loadEnvFile, databaseSettings } from './lib/env.mjs';

loadEnvFile();

const settings = databaseSettings();
const args = process.argv.slice(2);
const withSession = args.includes('--session');
const force = args.includes('--force');

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@contractorsguild.dev';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'guild-demo-password';
const PASSWORD_HASH_COST = Number(process.env.PASSWORD_HASH_COST ?? 16384);

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, {
    N: PASSWORD_HASH_COST,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$N=${PASSWORD_HASH_COST},r=8,p=1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function assertLocalDatabase() {
  const url = new URL(settings.appUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error('Refusing to seed demo data with NODE_ENV=production (pass --force to override).');
  }
  if (!localHosts.has(url.hostname) && !force) {
    throw new Error(
      `Refusing to seed demo data into ${url.hostname}; seeds are for local development (pass --force to override).`
    );
  }
  return url;
}

const demo = {
  customerA: {
    type: 'BUSINESS',
    business_name: 'Harbour Point Body Corporate',
    contact_person: 'Riaan Fourie',
    phone: '021 555 0110',
    email: 'riaan@example.co.za',
    billing_city: 'Cape Town',
    billing_province: 'Western Cape',
    billing_postal_code: '8001',
  },
  customerB: {
    type: 'INDIVIDUAL',
    business_name: 'Naledi Mokoena',
    contact_person: 'Naledi Mokoena',
    phone: '082 555 0142',
    email: 'naledi@example.co.za',
    billing_city: 'Bellville',
    billing_province: 'Western Cape',
    billing_postal_code: '7530',
  },
  customerC: {
    type: 'BUSINESS',
    business_name: 'Table Bay Coffee Roasters',
    contact_person: 'Sam Petersen',
    phone: '021 555 0188',
    email: 'sam@example.co.za',
    billing_city: 'Paarden Eiland',
    billing_province: 'Western Cape',
    billing_postal_code: '7405',
  },
  products: [
    { kind: 'SERVICE', name: 'Fault finding (after hours)', unit: 'hour', price: '685.00', tax: '15.00', category: 'Electrical' },
    { kind: 'SERVICE', name: 'Distribution board replacement', unit: 'job', price: '4850.00', tax: '15.00', category: 'Electrical' },
    { kind: 'SERVICE', name: 'Certificate of Compliance inspection', unit: 'job', price: '1550.00', tax: '15.00', category: 'Compliance' },
    { kind: 'PRODUCT', name: '20A circuit breaker', unit: 'each', price: '145.00', tax: '15.00', category: 'Components', sku: 'CB-20A' },
    { kind: 'PRODUCT', name: '2.5mm² twin & earth cable', unit: 'metre', price: '38.50', tax: '15.00', category: 'Cable', sku: 'CABLE-2.5' },
  ],
  jobs: [
    { title: 'Kitchen plugs tripping the earth leakage', status: 'SCHEDULED', type: 'Fault finding', customer: 'B', daysFromNow: 2 },
    { title: 'Garage DB board replacement', status: 'IN_PROGRESS', type: 'Installation', customer: 'A', daysFromNow: 0 },
    { title: 'Annual COC inspection - roastery', status: 'COMPLETED', type: 'Compliance', customer: 'C', daysFromNow: -9 },
    { title: 'Load shedding inverter quote request', status: 'LEAD', type: 'Quote request', customer: 'B', daysFromNow: 5 },
  ],
  // Quotes cover the three states a contractor sees most often: one waiting on
  // the customer, one already accepted, and one still being built. The public
  // link of an open quote is printed at the end of the seed so the acceptance
  // page can be opened straight from the terminal.
  quotes: [
    {
      reference: 'open',
      customer: 'B',
      jobIndex: 4,
      status: 'SENT',
      daysAgo: 2,
      jobType: 'Quote request',
      description: 'Supply and install a 5kW hybrid inverter with battery backup for the shop floor.',
      paymentTerms: 'Payment due within 30 days of invoice date.',
      notes: 'Includes commissioning and a walk-through with the shop manager.',
      termsAndConditions: '50% deposit on acceptance. Work starts within 10 working days.',
      lines: [
        { name: '5kW hybrid inverter installation', quantity: 1, price: '18500.00', discount: 0 },
        { name: 'Lithium battery, 5.1kWh', quantity: 1, price: '22400.00', discount: 5 },
        { name: '2.5mm twin & earth cable', quantity: 40, price: '38.50', discount: 0 },
      ],
    },
    {
      reference: 'accepted',
      customer: 'A',
      jobIndex: 2,
      status: 'ACCEPTED',
      daysAgo: 6,
      jobType: 'Installation',
      description: 'Replace the garage distribution board and re-label every circuit.',
      notes: 'Building access from 07:00. Site contact is the body corporate caretaker.',
      termsAndConditions: 'Workmanship guaranteed for 12 months.',
      lines: [
        { name: 'Distribution board replacement', quantity: 1, price: '4850.00', discount: 0 },
        { name: '20A circuit breaker', quantity: 1, price: '145.00', discount: 0 },
        { name: 'Labour - certified electrician', quantity: 8, price: '650.00', discount: 0 },
      ],
    },
    {
      reference: 'draft',
      customer: 'C',
      status: 'DRAFT',
      daysAgo: 1,
      jobType: 'Compliance',
      description: 'Annual certificate of compliance inspection for the roastery.',
      lines: [
        { name: 'Certificate of Compliance inspection', quantity: 1, price: '1550.00', discount: 0 },
        { name: 'Fault finding - first hour', quantity: 1, price: '690.00', discount: 0 },
      ],
    },
  ],
};

/** Money helpers: the database stores numeric(14,2), the seed speaks cents. */
function toCents(value) {
  return Math.round(Number(value) * 100);
}

function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

function summariseLines(lines) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const rows = lines.map((line, index) => {
    const gross = toCents(line.price) * line.quantity;
    const discount = Math.round((gross * (line.discount ?? 0)) / 100);
    const net = gross - discount;
    const tax = Math.round((net * 15) / 100);
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    return {
      lineNumber: index + 1,
      description: line.name,
      quantity: line.quantity,
      unit: line.unit ?? 'each',
      unitPrice: toCents(line.price),
      discountPercent: line.discount ?? 0,
      taxRate: 15,
      lineSubtotal: gross,
      lineDiscount: discount,
      lineTax: tax,
      lineTotal: net + tax,
    };
  });
  return { rows, subtotal, discountTotal, taxTotal, total: subtotal - discountTotal + taxTotal };
}

async function main() {
  const url = assertLocalDatabase();

  // The existence check runs with the admin role: the application role cannot
  // see a user row before it has tenant context (row level security), which is
  // exactly the behaviour we want in the app and exactly why tooling needs a
  // separate connection. The insert below still runs as the application role.
  const admin = new Client({ connectionString: settings.adminUrl, ssl: false, connectionTimeoutMillis: 8000 });
  await admin.connect();
  let existingDemoUser = null;
  try {
    const existing = await admin.query('select id from users where lower(email) = lower($1)', [DEMO_EMAIL]);
    existingDemoUser = existing.rows[0] ?? null;

    if (existingDemoUser && force) {
      // --force means "rebuild the demo tenant": drop the previous one first,
      // otherwise the unique index on lower(email) rejects the new owner. Every
      // business-owned row hangs off businesses with ON DELETE CASCADE.
      await admin.query(
        `delete from businesses
          where id in (select business_id from business_users where user_id = $1)`,
        [existingDemoUser.id]
      );
      await admin.query('delete from users where id = $1', [existingDemoUser.id]);
      console.log(`↺ Removed the previous demo tenant (${DEMO_EMAIL}) before reseeding.`);
      existingDemoUser = null;
    }
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: settings.appUrl, ssl: false, connectionTimeoutMillis: 8000 });
  await client.connect();

  try {
    if (existingDemoUser && !force) {
      console.log(`✓ Demo contractor already seeded (${DEMO_EMAIL}); nothing to do.`);
      if (withSession) await printSession(client, existingDemoUser.id);
      return;
    }

    const userId = randomUUID();
    const businessId = randomUUID();

    await client.query('begin');
    // The application role needs the tenant context, exactly like a request.
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId]);
    await client.query('select set_config($1, $2, true)', ['app.business_id', businessId]);

    await client.query(
      `insert into users (id, email, password_hash, full_name, phone)
       values ($1, $2, $3, $4, $5)`,
      [userId, DEMO_EMAIL, hashPassword(DEMO_PASSWORD), 'Demo Contractor', '021 555 0100']
    );

    await client.query(
      `insert into businesses
         (id, legal_name, trading_name, registration_number, tax_number, address_line1, city, province,
          postal_code, country, phone, email, website, whatsapp, currency_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ZAR')`,
      [
        businessId,
        'Demo Electrical & Maintenance (Pty) Ltd',
        'Demo Sparks',
        '2019/000000/07',
        '4000000000',
        'Unit 4, 12 Industry Road',
        'Cape Town',
        'Western Cape',
        '7405',
        'South Africa',
        '021 555 0100',
        'office@example.co.za',
        'https://example.co.za',
        '27215550100',
      ]
    );

    await client.query(
      `insert into business_users (business_id, user_id, role, status)
       values ($1, $2, 'OWNER', 'ACTIVE')`,
      [businessId, userId]
    );

    await client.query(
      `insert into business_settings
         (business_id, default_payment_terms, default_quote_validity_days, default_tax_rate,
          quote_prefix, invoice_prefix, receipt_prefix, bank_name, bank_account_name,
          bank_account_number, bank_branch_code, bank_account_type, payment_instructions, invoice_footer_note)
       values ($1, 'Payment due within 30 days of invoice date.', 30, 15.00,
               'QUOTE-', 'INV-', 'REC-', 'Demo Bank', 'Demo Electrical & Maintenance (Pty) Ltd',
               '0000000000', '000000', 'Current', 'Please use the invoice number as your payment reference.',
               'Demo data only - replace these details with your own banking information.')`,
      [businessId]
    );

    await client.query(
      `insert into document_sequences (business_id, doc_type, prefix, next_number)
       values ($1, 'JOB', 'JOB-', 1), ($1, 'QUOTE', 'QUOTE-', 1),
              ($1, 'INVOICE', 'INV-', 1), ($1, 'RECEIPT', 'REC-', 1)`,
      [businessId]
    );

    const customerIds = {};
    for (const [key, customer] of Object.entries({
      A: demo.customerA,
      B: demo.customerB,
      C: demo.customerC,
    })) {
      const { rows } = await client.query(
        `insert into customers
           (business_id, customer_type, business_name, contact_person, phone, email,
            billing_city, billing_province, billing_postal_code, billing_country, site_city, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'South Africa', $7, $10)
         returning id`,
        [
          businessId,
          customer.type,
          customer.business_name,
          customer.contact_person,
          customer.phone,
          customer.email,
          customer.billing_city,
          customer.billing_province,
          customer.billing_postal_code,
          userId,
        ]
      );
      customerIds[key] = rows[0].id;
    }

    const productIds = {};
    for (const product of demo.products) {
      const { rows } = await client.query(
        `insert into products
           (business_id, kind, name, category, unit, sku, default_price, tax_rate, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          businessId,
          product.kind,
          product.name,
          product.category,
          product.unit,
          product.sku ?? null,
          product.price,
          product.tax,
          userId,
        ]
      );
      productIds[product.name] = rows[0].id;
    }

    const jobIds = [];
    let jobNumber = 1;
    for (const job of demo.jobs) {
      const scheduled = new Date(Date.now() + job.daysFromNow * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const { rows } = await client.query(
        `insert into jobs
           (business_id, customer_id, job_number, title, description, job_type, status,
            scheduled_date, completed_date, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          businessId,
          customerIds[job.customer],
          `JOB-${String(jobNumber).padStart(4, '0')}`,
          job.title,
          'Seeded demo job - safe to edit or ignore.',
          job.type,
          job.status,
          scheduled,
          job.status === 'COMPLETED' ? scheduled : null,
          userId,
        ]
      );
      jobIds.push(rows[0].id);
      jobNumber += 1;
    }

    await client.query(
      `insert into document_sequences (business_id, doc_type, prefix, next_number)
       values ($1, 'JOB', 'JOB-', $2)
       on conflict (business_id, doc_type) do update set next_number = excluded.next_number`,
      [businessId, jobNumber]
    );

    let quoteNumber = 1;
    const publicQuoteLinks = [];
    let seededInvoice = null;
    for (const quote of demo.quotes) {
      const summary = summariseLines(quote.lines);
      const issueDate = new Date(Date.now() - quote.daysAgo * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const validUntil = new Date(
        Date.now() + (30 - quote.daysAgo) * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);
      const sentAt =
        quote.status === 'DRAFT' ? null : new Date(Date.now() - quote.daysAgo * 24 * 60 * 60 * 1000);
      const answered = quote.status === 'ACCEPTED';
      const token =
        quote.status === 'DRAFT' ? null : randomBytes(16).toString('base64url').slice(0, 32);

      const { rows } = await client.query(
        `insert into quotes
           (business_id, customer_id, job_id, quote_number, status, issue_date, valid_until,
            contact_person, contact_phone, contact_email, job_type, description,
            subtotal, discount_total, tax_total, total, payment_terms, notes, terms_and_conditions,
            public_token, sent_at, viewed_at, accepted_at, accepted_by_name, accepted_ip, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         returning id`,
        [
          businessId,
          customerIds[quote.customer],
          quote.jobIndex ? jobIds[quote.jobIndex - 1] : null,
          `QUOTE-${String(quoteNumber).padStart(4, '0')}`,
          quote.status,
          issueDate,
          validUntil,
          null,
          null,
          null,
          quote.jobType,
          quote.description,
          fromCents(summary.subtotal),
          fromCents(summary.discountTotal),
          fromCents(summary.taxTotal),
          fromCents(summary.total),
          quote.paymentTerms ?? null,
          quote.notes ?? null,
          quote.termsAndConditions ?? null,
          token,
          sentAt,
          answered ? sentAt : null,
          answered ? sentAt : null,
          answered ? 'Riaan Fourie' : null,
          answered ? '192.0.2.10' : null,
          userId,
        ]
      );
      const quoteId = rows[0].id;

      for (const line of summary.rows) {
        await client.query(
          `insert into quote_items
             (business_id, quote_id, product_id, line_number, description, quantity, unit,
              unit_price, discount_percent, tax_rate,
              line_subtotal, line_discount, line_tax, line_total)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            businessId,
            quoteId,
            productIds[line.description] ?? null,
            line.lineNumber,
            line.description,
            line.quantity,
            line.unit,
            fromCents(line.unitPrice),
            line.discountPercent,
            line.taxRate,
            fromCents(line.lineSubtotal),
            fromCents(line.lineDiscount),
            fromCents(line.lineTax),
            fromCents(line.lineTotal),
          ]
        );
      }

      const events = [
        ['quote.created', userId, { number: `QUOTE-${String(quoteNumber).padStart(4, '0')}` }],
        ...(sentAt ? [['quote.sent', userId, { because: 'seed' }]] : []),
        ...(answered ? [['quote.accepted', userId, { accepted_by: 'Riaan Fourie' }]] : []),
      ];
      for (const [eventType, actor, metadata] of events) {
        await client.query(
          `insert into audit_events
             (business_id, user_id, event_type, entity_type, entity_id, metadata)
           values ($1, $2, $3, 'quote', $4, $5)`,
          [businessId, actor, eventType, quoteId, JSON.stringify(metadata)]
        );
      }

      if (token) {
        publicQuoteLinks.push({
          number: `QUOTE-${String(quoteNumber).padStart(4, '0')}`,
          status: quote.status,
          token,
        });
      }
      quoteNumber += 1;
    }

    await client.query(
      `insert into document_sequences (business_id, doc_type, prefix, next_number)
       values ($1, 'QUOTE', 'QUOTE-', $2)
       on conflict (business_id, doc_type) do update set next_number = excluded.next_number`,
      [businessId, quoteNumber]
    );

    // One converted quote (the accepted one) becomes INV-0001 so the invoices
    // screen, the dashboard outstanding figures and the PDF all have a real
    // row to show on a fresh seed.
    const acceptedQuoteId = (
      await client.query(
        `select id from quotes where business_id = $1 and status = 'ACCEPTED' limit 1`,
        [businessId]
      )
    ).rows[0]?.id;

    if (acceptedQuoteId) {
      const invoiceNumber = 'INV-0001';
      // Issued two weeks ago so the part payment below sits between issue and
      // due, the way a real partial payment does.
      const invoiceIssueDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const invoiceDueDate = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const quoteHeader = (
        await client.query(
          `select customer_id, job_id, contact_person, contact_phone, contact_email,
                  job_address_line1, job_address_line2, job_city, job_province, job_postal_code,
                  job_type, description, subtotal, discount_total, tax_total, total,
                  payment_terms, notes, terms_and_conditions
             from quotes where id = $1`,
          [acceptedQuoteId]
        )
      ).rows[0];

      const billing = (
        await client.query(
          `select billing_address_line1, billing_address_line2, billing_city, billing_province,
                  billing_postal_code
             from customers where id = $1`,
          [quoteHeader.customer_id]
        )
      ).rows[0];

      const { rows: invoiceRows } = await client.query(
        `insert into invoices
           (business_id, customer_id, job_id, quote_id, invoice_number, status, issue_date,
            due_date, contact_person, contact_phone, contact_email,
            billing_address_line1, billing_address_line2, billing_city, billing_province,
            billing_postal_code, job_address_line1, job_address_line2, job_city, job_province,
            job_postal_code, job_type, description, subtotal, discount_total, tax_total, total,
            payment_terms, notes, terms_and_conditions, created_by)
         values ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
         returning id`,
        [
          businessId,
          quoteHeader.customer_id,
          quoteHeader.job_id,
          acceptedQuoteId,
          invoiceNumber,
          invoiceIssueDate,
          invoiceDueDate,
          quoteHeader.contact_person,
          quoteHeader.contact_phone,
          quoteHeader.contact_email,
          billing?.billing_address_line1 ?? null,
          billing?.billing_address_line2 ?? null,
          billing?.billing_city ?? null,
          billing?.billing_province ?? null,
          billing?.billing_postal_code ?? null,
          quoteHeader.job_address_line1,
          quoteHeader.job_address_line2,
          quoteHeader.job_city,
          quoteHeader.job_province,
          quoteHeader.job_postal_code,
          quoteHeader.job_type,
          quoteHeader.description,
          quoteHeader.subtotal,
          quoteHeader.discount_total,
          quoteHeader.tax_total,
          quoteHeader.total,
          quoteHeader.payment_terms,
          quoteHeader.notes,
          quoteHeader.terms_and_conditions,
          userId,
        ]
      );
      const invoiceId = invoiceRows[0].id;

      const quoteLines = (
        await client.query(
          `select product_id, line_number, description, quantity, unit, unit_price,
                  discount_percent, tax_rate, line_subtotal, line_discount, line_tax, line_total
             from quote_items where quote_id = $1 order by line_number`,
          [acceptedQuoteId]
        )
      ).rows;

      for (const line of quoteLines) {
        await client.query(
          `insert into invoice_items
             (business_id, invoice_id, product_id, line_number, description, quantity, unit,
              unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
              line_total)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            businessId,
            invoiceId,
            line.product_id,
            line.line_number,
            line.description,
            line.quantity,
            line.unit,
            line.unit_price,
            line.discount_percent,
            line.tax_rate,
            line.line_subtotal,
            line.line_discount,
            line.line_tax,
            line.line_total,
          ]
        );
      }

      await client.query(
        `insert into document_sequences (business_id, doc_type, prefix, next_number)
         values ($1, 'INVOICE', 'INV-', $2)
         on conflict (business_id, doc_type) do update set next_number = excluded.next_number`,
        [businessId, 2]
      );

      await client.query(
        `insert into audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
         values ($1, $2, 'invoice.converted_from_quote', 'invoice', $3, $4),
                ($1, $2, 'quote.converted', 'quote', $5, $6)`,
        [
          businessId,
          userId,
          invoiceId,
          JSON.stringify({ invoice_number: invoiceNumber, because: 'seed' }),
          acceptedQuoteId,
          JSON.stringify({ invoice_number: invoiceNumber, because: 'seed' }),
        ]
      );

      // Phase 5 demo story: a part payment on the converted invoice. The
      // balance drops, the status becomes PARTIALLY_PAID, and REC-0001 is
      // issued - exactly what the payments screen and the receipt PDF show.
      const invoiceTotalCents = toCents(quoteHeader.total);
      const partCents = 250000; // R2 500.00
      const partPayment = {
        amount: fromCents(partCents),
        previousBalance: fromCents(invoiceTotalCents),
        remainingBalance: fromCents(invoiceTotalCents - partCents),
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      };

      await client.query(
        `update invoices
            set status = 'PARTIALLY_PAID'::public.invoice_status,
                sent_at = $3::timestamptz,
                amount_paid = $4
          where id = $1 and business_id = $2`,
        [
          invoiceId,
          businessId,
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          partPayment.amount,
        ]
      );

      const payment1 = (
        await client.query(
          `insert into payments
             (business_id, invoice_id, customer_id, amount, payment_date, method,
              reference, notes, recorded_by, receipt_number)
           values ($1, $2, $3, $4, $5, 'EFT', 'ACC-44190', 'Part payment - balance to follow.', $6, 'REC-0001')
           returning id`,
          [
            businessId,
            invoiceId,
            quoteHeader.customer_id,
            partPayment.amount,
            partPayment.date,
            userId,
          ]
        )
      ).rows[0].id;

      await client.query(
        `insert into receipts
           (business_id, payment_id, invoice_id, customer_id, receipt_number, issued_at,
            amount_received, previous_balance, remaining_balance, method, reference, status_before)
         values ($1, $2, $3, $4, 'REC-0001', $5, $6, $7, $8, 'EFT', 'ACC-44190', 'SENT')`,
        [
          businessId,
          payment1,
          invoiceId,
          quoteHeader.customer_id,
          new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          partPayment.amount,
          partPayment.previousBalance,
          partPayment.remainingBalance,
        ]
      );

      await client.query(
        `insert into audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
         values ($1, $2, 'payment.recorded', 'payment', $3, $4),
                ($1, $2, 'invoice.payment_received', 'invoice', $5, $6)`,
        [
          businessId,
          userId,
          payment1,
          JSON.stringify({
            invoice_number: invoiceNumber,
            amount: partPayment.amount,
            receipt_number: 'REC-0001',
            status_before: 'SENT',
            status_after: 'PARTIALLY_PAID',
            because: 'seed',
          }),
          invoiceId,
          JSON.stringify({
            payment_id: payment1,
            amount: partPayment.amount,
            receipt_number: 'REC-0001',
            because: 'seed',
          }),
        ]
      );

      seededInvoice = { number: invoiceNumber, quote: 'accepted quote', payment: partPayment.amount };
    }

    // Second demo story: a smaller invoice, issued and paid in full, so the
    // PAID filter, the settled receipt and the dashboard revenue all have a
    // real row on a fresh seed.
    const paidSummary = summariseLines([
      { name: 'Certificate of Compliance inspection', quantity: 1, price: '1550.00', discount: 0 },
      { name: 'Fault finding - first hour', quantity: 1, price: '690.00', discount: 0 },
    ]);
    const paidInvoiceId = (
      await client.query(
        `insert into invoices
           (business_id, customer_id, job_id, invoice_number, status, issue_date, due_date,
            job_type, description, subtotal, discount_total, tax_total, total,
            payment_terms, sent_at, created_by)
         values ($1, $2, $3, 'INV-0002', 'SENT', $4, $5, 'Compliance',
                 'Annual certificate of compliance inspection for the roastery, signed off.',
                 $6, $7, $8, $9, 'Payment due within 30 days of invoice date.', $10, $11)
         returning id`,
        [
          businessId,
          customerIds.C,
          jobIds[2] ?? null,
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          new Date(Date.now() + 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          fromCents(paidSummary.subtotal),
          fromCents(paidSummary.discountTotal),
          fromCents(paidSummary.taxTotal),
          fromCents(paidSummary.total),
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          userId,
        ]
      )
    ).rows[0].id;

    for (const line of paidSummary.rows) {
      await client.query(
        `insert into invoice_items
           (business_id, invoice_id, product_id, line_number, description, quantity, unit,
            unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
            line_total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          businessId,
          paidInvoiceId,
          productIds[line.description] ?? null,
          line.lineNumber,
          line.description,
          line.quantity,
          line.unit,
          fromCents(line.unitPrice),
          line.discountPercent,
          line.taxRate,
          fromCents(line.lineSubtotal),
          fromCents(line.lineDiscount),
          fromCents(line.lineTax),
          fromCents(line.lineTotal),
        ]
      );
    }

    const paidAmount = fromCents(paidSummary.total);
    const paidDate = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);

    await client.query(
      `update invoices
          set amount_paid = $3,
              status = 'PAID'::public.invoice_status,
              paid_at = $4
        where id = $1 and business_id = $2`,
      [paidInvoiceId, businessId, paidAmount, paidDate]
    );

    const payment2 = (
      await client.query(
        `insert into payments
           (business_id, invoice_id, customer_id, amount, payment_date, method,
            reference, notes, recorded_by, receipt_number)
         values ($1, $2, $3, $4, $5, 'EFT', 'PAY-778201', 'Paid in full - thank you!', $6, 'REC-0002')
         returning id`,
        [businessId, paidInvoiceId, customerIds.C, paidAmount, paidDate.toISOString().slice(0, 10), userId]
      )
    ).rows[0].id;

    await client.query(
      `insert into receipts
         (business_id, payment_id, invoice_id, customer_id, receipt_number, issued_at,
          amount_received, previous_balance, remaining_balance, method, reference, status_before)
       values ($1, $2, $3, $4, 'REC-0002', $5, $6, $6, '0.00', 'EFT', 'PAY-778201', 'SENT')`,
      [businessId, payment2, paidInvoiceId, customerIds.C, paidDate, paidAmount]
    );

    await client.query(
      `insert into audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
       values ($1, $2, 'payment.recorded', 'payment', $3, $4),
              ($1, $2, 'invoice.payment_received', 'invoice', $5, $6)`,
      [
        businessId,
        userId,
        payment2,
        JSON.stringify({
          invoice_number: 'INV-0002',
          amount: paidAmount,
          receipt_number: 'REC-0002',
          because: 'seed',
        }),
        paidInvoiceId,
        JSON.stringify({
          payment_id: payment2,
          amount: paidAmount,
          receipt_number: 'REC-0002',
          because: 'seed',
        }),
      ]
    );

    await client.query(
      `insert into document_sequences (business_id, doc_type, prefix, next_number)
       values ($1, 'INVOICE', 'INV-', 3), ($1, 'RECEIPT', 'REC-', 3)
       on conflict (business_id, doc_type) do update set next_number = excluded.next_number`,
      [businessId]
    );

    await client.query(
      `insert into audit_events (business_id, user_id, event_type, entity_type, metadata)
       values ($1, $2, 'seed.demo_contractor', 'business', $3)`,
      [businessId, userId, JSON.stringify({ source: 'scripts/seeds.mjs' })]
    );

    await client.query('commit');

    console.log('✓ Seeded demo contractor');
    console.log(`  business : Demo Electrical & Maintenance (Pty) Ltd (Demo Sparks)`);
    console.log(`  login    : ${DEMO_EMAIL}`);
    console.log(`  password : ${DEMO_PASSWORD}`);
    console.log(
      `  data     : 3 customers, ${demo.products.length} catalogue items, ${demo.jobs.length} jobs, ` +
        `${demo.quotes.length} quotes` +
        (seededInvoice
          ? ', 2 invoices (INV-0001 partially paid, INV-0002 paid in full), 2 payments with receipts'
          : '')
    );
    console.log(`  database : ${url.hostname}:${url.port}${url.pathname}`);

    if (publicQuoteLinks.length > 0) {
      const base = (process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      console.log('');
      console.log('  Customer quote links (no sign-in needed):');
      for (const link of publicQuoteLinks) {
        console.log(`  ${link.number} (${link.status}) ${base}/q/${link.token}`);
      }
    }

    if (withSession) {
      await printSession(client, userId);
    }
  } finally {
    await client.end();
  }
}

/** Development helper: print a session cookie so a preview can open /app directly. */
async function printSession(client, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const membership = await client.query(
    'select business_id from business_users where user_id = $1 and status = $$ACTIVE$$ limit 1',
    [userId]
  );
  const businessId = membership.rows[0]?.business_id ?? null;

  await client.query('begin');
  await client.query('select set_config($1, $2, true)', ['app.user_id', userId]);
  if (businessId) {
    await client.query('select set_config($1, $2, true)', ['app.business_id', businessId]);
  }
  await client.query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, 'scripts/seeds.mjs')`,
    [userId, hashToken(token), expiresAt]
  );
  await client.query('commit');

  console.log('');
  console.log('  Session cookie for local previews (expires in 7 days):');
  console.log(`  cg_session=${token}`);
}

main().catch((error) => {
  console.error('✗ Seed failed:', error.message);
  process.exitCode = 1;
});
