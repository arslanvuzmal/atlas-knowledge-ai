import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database/client';
import { getSession } from '@/lib/auth/session';
import { getCurrentWorkspaceContext, type WorkspaceContext } from '@/lib/workspace/context';
import { listContacts } from '@/lib/crm/contact';
import { listCompanies } from '@/lib/crm/company';
import { listDeals } from '@/lib/crm/deal';
import { listTasks } from '@/lib/crm/task';
import { listTickets } from '@/lib/crm/ticket';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report: Record<string, unknown> = {};

  // 1. Test session
  try {
    const session = await getSession();
    report.session = { role: session.role, isAuth: session.isAuthenticated, user: session.user };
  } catch (err: unknown) {
    report.sessionError = err instanceof Error ? err.message : String(err);
  }

  // 2. Test workspace
  try {
    const ws = await getCurrentWorkspaceContext();
    report.workspace = ws;
  } catch (err: unknown) {
    report.workspaceError = err instanceof Error ? err.message : String(err);
  }

  // 3. Test Prisma workspace table
  try {
    const wsCount = await prisma.workspace.count();
    report.workspaceTableCount = wsCount;
  } catch (err: unknown) {
    report.workspaceTableError = err instanceof Error ? err.message : String(err);
  }

  // 4. Test Prisma contact table
  try {
    const contactCount = await prisma.contact.count();
    report.contactTableCount = contactCount;
  } catch (err: unknown) {
    report.contactTableError = err instanceof Error ? err.message : String(err);
  }

  // 5. Test CRM functions
  const wsId = (report.workspace as WorkspaceContext | undefined)?.id || 'default-workspace-id';
  try {
    report.contactsList = await listContacts(wsId);
  } catch (err: unknown) {
    report.contactsListError = err instanceof Error ? err.message : String(err);
  }

  try {
    report.companiesList = await listCompanies(wsId);
  } catch (err: unknown) {
    report.companiesListError = err instanceof Error ? err.message : String(err);
  }

  try {
    report.dealsList = await listDeals(wsId);
  } catch (err: unknown) {
    report.dealsListError = err instanceof Error ? err.message : String(err);
  }

  try {
    report.tasksList = await listTasks(wsId);
  } catch (err: unknown) {
    report.tasksListError = err instanceof Error ? err.message : String(err);
  }

  try {
    report.ticketsList = await listTickets(wsId);
  } catch (err: unknown) {
    report.ticketsListError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(report);
}
