import { createSessionToken } from '../src/lib/auth';
import type { Role } from '../src/generated/prisma/client';

const portals: { role: Role; name: string; staffId: string; warehouseId: string; pages: string[] }[] = [
  {
    role: 'ADMIN',
    name: 'Admin User',
    staffId: 'ADM-001',
    warehouseId: 'wh-main',
    pages: [
      '/admin',
      '/admin/approvals',
      '/admin/alerts',
      '/admin/warehouses',
      '/admin/users',
      '/admin/products',
      '/admin/customers',
      '/admin/suppliers',
      '/admin/cash',
      '/admin/reports',
      '/admin/audit',
      '/admin/settings',
      '/admin/transactions',
    ],
  },
  {
    role: 'MANAGER',
    name: 'Manager User',
    staffId: 'MGR-001',
    warehouseId: 'wh-main',
    pages: [
      '/manager',
      '/manager/tasks',
      '/manager/alerts',
      '/manager/orders',
      '/manager/products',
      '/manager/inventory',
      '/manager/cash',
      '/manager/customers',
      '/manager/suppliers',
      '/manager/staff',
      '/manager/reports',
      '/manager/transactions',
      '/manager/warehouse',
      '/manager/settings',
      '/manager/audit',
      '/manager/review',
    ],
  },
  {
    role: 'PROCUREMENT',
    name: 'Procurement User',
    staffId: 'PRO-001',
    warehouseId: 'wh-main',
    pages: [
      '/procurement',
      '/procurement/suppliers',
      '/procurement/requisitions',
      '/procurement/orders',
      '/procurement/orders/new',
      '/procurement/rates',
    ],
  },
  {
    role: 'INVENTORY',
    name: 'Inventory User',
    staffId: 'INV-001',
    warehouseId: 'wh-main',
    pages: [
      '/inventory',
      '/inventory/grn',
      '/inventory/outward',
      '/inventory/count',
      '/inventory/reports',
    ],
  },
  {
    role: 'BILLING',
    name: 'Billing Cashier',
    staffId: 'BIL-001',
    warehouseId: 'wh-main',
    pages: [
      '/billing',
      '/billing/new',
      '/billing/orders',
      '/billing/orders/new',
      '/billing/gst-bill',
      '/billing/gst-bill/invoices',
      '/billing/discounts',
    ],
  },
  {
    role: 'FINANCE',
    name: 'Finance Officer',
    staffId: 'FIN-001',
    warehouseId: 'wh-main',
    pages: [
      '/finance',
      '/finance/cash',
      '/finance/bank',
      '/finance/upi',
      '/finance/receivables',
      '/finance/payables',
      '/finance/expenses',
      '/finance/vouchers',
      '/finance/reports',
      '/finance/inventory',
      '/finance/orders',
      '/finance/orders/new',
      '/finance/gst-bill',
      '/finance/gst-bill/invoices',
    ],
  },
  {
    role: 'QC',
    name: 'QC Inspector',
    staffId: 'QC-001',
    warehouseId: 'wh-main',
    pages: [
      '/qc',
    ],
  },
];

async function main() {
  console.log('Testing portal pages with valid wms_session cookie...');
  let totalTested = 0;
  let passed = 0;
  let failed = 0;

  for (const portal of portals) {
    console.log(`\n=== Testing Portal: ${portal.role} ===`);
    const token = await createSessionToken({
      sub: `usr-${portal.role.toLowerCase()}`,
      staffId: portal.staffId,
      name: portal.name,
      role: portal.role,
      warehouseId: portal.warehouseId,
      sid: 'dev-session-sid',
    });

    for (const p of portal.pages) {
      totalTested++;
      try {
        const res = await fetch(`http://localhost:3000${p}`, {
          headers: {
            Cookie: `wms_session=${token}`,
          },
          redirect: 'manual',
        });

        if (res.status === 200) {
          console.log(`  [OK 200] ${p}`);
          passed++;
        } else if (res.status === 307 || res.status === 302 || res.status === 303) {
          const loc = res.headers.get('location');
          console.log(`  [REDIRECT ${res.status}] ${p} -> ${loc}`);
          if (loc?.startsWith('/login')) {
            console.error(`  [FAIL REDIRECTED TO LOGIN] ${p}`);
            failed++;
          } else {
            passed++;
          }
        } else {
          console.error(`  [FAIL ${res.status}] ${p}`);
          failed++;
        }
      } catch (err: any) {
        console.error(`  [ERROR] ${p}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n--- Summary: ${totalTested} tested, ${passed} passed, ${failed} failed ---`);
}

main().catch(console.error);
