import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

interface BambooHRConfig {
  subdomain: string;
  apiKey: string;
}

const getBambooHRConfig = (): BambooHRConfig | null => {
  const subdomain = process.env.BAMBOOHR_SUBDOMAIN;
  const apiKey = process.env.BAMBOOHR_API_KEY;

  if (!subdomain || !apiKey) return null;

  return { subdomain, apiKey };
};

const bambooFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const config = getBambooHRConfig();
  if (!config) throw new Error('BambooHR is not configured');

  const url = `https://api.bamboohr.com/api/gateway.php/${config.subdomain}/v1${path}`;
  const auth = Buffer.from(`${config.apiKey}:x`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`BambooHR API error (${response.status}): ${errorBody}`);
  }

  return response;
};

interface BambooEmployee {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  jobTitle: string;
  workEmail: string;
  department: string;
  location: string;
  division: string;
  supervisor: string;
  status: string;
  hireDate: string;
}

interface BambooTimeOffEntry {
  id: string;
  type: string;
  employeeId: string;
  name: string;
  start: string;
  end: string;
}

interface BambooTimeOffRequest {
  id: string;
  employeeId: string;
  status: { status: string };
  name: string;
  start: string;
  end: string;
  type: { id: string; name: string };
  amount: { unit: string; amount: string };
  notes: { employee: string; manager: string };
  created: string;
}

export class BambooHRIntegration extends BaseIntegration {
  id = 'bamboohr';
  name = 'BambooHR';
  description = 'Access BambooHR for employee data and HR management';
  icon = '🌿';

  isEnabled(): boolean {
    return getBambooHRConfig() !== null;
  }

  getTools() {
    return {
      list_employees: tool({
        description: 'List employees in the organization',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query (name)'),
          department: z.string().optional().describe('Filter by department'),
          location: z.string().optional().describe('Filter by location'),
          status: z.enum(['Active', 'Inactive', 'all']).optional().describe('Employment status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
        }),
        execute: async ({
          query,
          department,
          location,
          status,
          limit,
        }: {
          query?: string;
          department?: string;
          location?: string;
          status?: string;
          limit?: number;
        }) => {
          try {
            const response = await withRetry(
              () => bambooFetch('/employees/directory'),
              { integrationId: this.id, operation: 'list employees' },
            );

            const data = await response.json() as { employees: BambooEmployee[] };
            let employees = data.employees || [];

            // Apply filters
            if (query) {
              const lowerQuery = query.toLowerCase();
              employees = employees.filter(
                (e) =>
                  e.displayName?.toLowerCase().includes(lowerQuery) ||
                  e.firstName?.toLowerCase().includes(lowerQuery) ||
                  e.lastName?.toLowerCase().includes(lowerQuery),
              );
            }
            if (department) {
              employees = employees.filter((e) => e.department === department);
            }
            if (location) {
              employees = employees.filter((e) => e.location === location);
            }
            if (status && status !== 'all') {
              employees = employees.filter((e) => e.status === status);
            }

            employees = employees.slice(0, limit || 50);

            return {
              employees: employees.map((emp) => ({
                id: emp.id,
                name: emp.displayName,
                firstName: emp.firstName,
                lastName: emp.lastName,
                jobTitle: emp.jobTitle,
                email: emp.workEmail,
                department: emp.department,
                location: emp.location,
                status: emp.status,
                hireDate: emp.hireDate,
              })),
              total: employees.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_employee: tool({
        description: 'Get detailed information about a specific employee',
        inputSchema: z.object({
          employeeId: z.string().describe('BambooHR employee ID'),
          fields: z.array(z.string()).optional().describe('Specific fields to retrieve'),
        }),
        execute: async ({ employeeId, fields }: { employeeId: string; fields?: string[] }) => {
          try {
            const defaultFields = [
              'id', 'displayName', 'firstName', 'lastName', 'preferredName',
              'jobTitle', 'workEmail', 'department', 'location', 'division',
              'supervisor', 'status', 'hireDate', 'terminationDate',
              'workPhone', 'mobilePhone', 'employeeNumber',
            ];

            const fieldsToFetch = fields || defaultFields;
            const response = await withRetry(
              () => bambooFetch(`/employees/${employeeId}?fields=${fieldsToFetch.join(',')}`),
              { integrationId: this.id, operation: 'get employee' },
            );

            const employee = await response.json() as Record<string, string>;

            return {
              id: employee.id,
              name: employee.displayName,
              firstName: employee.firstName,
              lastName: employee.lastName,
              preferredName: employee.preferredName,
              jobTitle: employee.jobTitle,
              email: employee.workEmail,
              department: employee.department,
              location: employee.location,
              division: employee.division,
              supervisor: employee.supervisor,
              status: employee.status,
              hireDate: employee.hireDate,
              terminationDate: employee.terminationDate,
              workPhone: employee.workPhone,
              mobilePhone: employee.mobilePhone,
              employeeNumber: employee.employeeNumber,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_directory_by_department: tool({
        description: 'Get employee count and list by department',
        inputSchema: z.object({
          department: z.string().optional().describe('Specific department to look up'),
        }),
        execute: async ({ department }: { department?: string }) => {
          try {
            const response = await withRetry(
              () => bambooFetch('/employees/directory'),
              { integrationId: this.id, operation: 'get directory' },
            );

            const data = await response.json() as { employees: BambooEmployee[] };
            const employees = data.employees || [];

            // Group by department
            const byDepartment: Record<string, Array<{ id: string; name: string; jobTitle: string }>> = {};
            for (const emp of employees) {
              const dept = emp.department || 'Unassigned';
              if (!byDepartment[dept]) {
                byDepartment[dept] = [];
              }
              byDepartment[dept].push({
                id: emp.id,
                name: emp.displayName,
                jobTitle: emp.jobTitle,
              });
            }

            if (department) {
              return {
                department,
                employees: byDepartment[department] || [],
                count: (byDepartment[department] || []).length,
              };
            }

            return {
              departments: Object.entries(byDepartment).map(([dept, emps]) => ({
                department: dept,
                employeeCount: emps.length,
                employees: emps,
              })),
              totalEmployees: employees.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_who_is_out: tool({
        description: 'Get employees who are currently out or will be out',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD, default: today)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD, default: 30 days)'),
        }),
        execute: async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
          try {
            const start = startDate || new Date().toISOString().split('T')[0];
            const end = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const response = await withRetry(
              () => bambooFetch(`/time_off/whos_out?start=${start}&end=${end}`),
              { integrationId: this.id, operation: 'get who is out' },
            );

            const data = await response.json() as BambooTimeOffEntry[];

            return {
              period: { start, end },
              timeOff: data.map((entry) => ({
                id: entry.id,
                type: entry.type,
                employeeId: entry.employeeId,
                employeeName: entry.name,
                startDate: entry.start,
                endDate: entry.end,
              })),
              totalEntries: data.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_time_off_requests: tool({
        description: 'Get time off requests with optional filters',
        inputSchema: z.object({
          employeeId: z.string().optional().describe('Filter by employee ID'),
          status: z.enum(['approved', 'pending', 'denied', 'cancelled', 'all']).optional().describe('Request status'),
          startDate: z.string().optional().describe('Start date range'),
          endDate: z.string().optional().describe('End date range'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
        }),
        execute: async ({
          employeeId,
          status,
          startDate,
          endDate,
          limit,
        }: {
          employeeId?: string;
          status?: string;
          startDate?: string;
          endDate?: string;
          limit?: number;
        }) => {
          try {
            const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const end = endDate || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            let path = `/time_off/requests?start=${start}&end=${end}`;
            if (employeeId) path += `&employeeId=${employeeId}`;
            if (status && status !== 'all') path += `&status=${status}`;

            const response = await withRetry(
              () => bambooFetch(path),
              { integrationId: this.id, operation: 'get time off requests' },
            );

            const data = await response.json() as BambooTimeOffRequest[];
            const requests = data.slice(0, limit || 50);

            return {
              requests: requests.map((req) => ({
                id: req.id,
                employeeId: req.employeeId,
                employeeName: req.name,
                status: req.status?.status,
                type: req.type?.name,
                startDate: req.start,
                endDate: req.end,
                amount: req.amount ? `${req.amount.amount} ${req.amount.unit}` : null,
                employeeNote: req.notes?.employee,
                managerNote: req.notes?.manager,
                created: req.created,
              })),
              totalCount: requests.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_headcount_report: tool({
        description: 'Get a headcount summary by various dimensions',
        inputSchema: z.object({
          groupBy: z.enum(['department', 'location', 'status']).optional().describe('Group by dimension'),
        }),
        execute: async ({ groupBy }: { groupBy?: 'department' | 'location' | 'status' }) => {
          try {
            const response = await withRetry(
              () => bambooFetch('/employees/directory'),
              { integrationId: this.id, operation: 'get headcount' },
            );

            const data = await response.json() as { employees: BambooEmployee[] };
            const employees = data.employees || [];

            const activeEmployees = employees.filter((e) => e.status === 'Active');

            const dimension = groupBy || 'department';
            const grouped: Record<string, number> = {};

            for (const emp of activeEmployees) {
              const key = emp[dimension] || 'Unassigned';
              grouped[key] = (grouped[key] || 0) + 1;
            }

            return {
              totalHeadcount: activeEmployees.length,
              groupedBy: dimension,
              breakdown: Object.entries(grouped)
                .map(([key, count]) => ({ [dimension]: key, count }))
                .sort((a, b) => b.count - a.count),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_new_hires: tool({
        description: 'Get recently hired employees',
        inputSchema: z.object({
          daysBack: z.number().int().min(1).max(365).optional().describe('Days to look back (default: 30)'),
        }),
        execute: async ({ daysBack }: { daysBack?: number }) => {
          try {
            const days = daysBack || 30;
            const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const response = await withRetry(
              () => bambooFetch('/employees/directory'),
              { integrationId: this.id, operation: 'get new hires' },
            );

            const data = await response.json() as { employees: BambooEmployee[] };
            const employees = data.employees || [];

            const newHires = employees
              .filter((emp) => {
                if (!emp.hireDate) return false;
                return new Date(emp.hireDate) >= cutoffDate;
              })
              .sort((a, b) => new Date(b.hireDate).getTime() - new Date(a.hireDate).getTime());

            return {
              periodDays: days,
              newHires: newHires.map((emp) => ({
                id: emp.id,
                name: emp.displayName,
                jobTitle: emp.jobTitle,
                department: emp.department,
                location: emp.location,
                hireDate: emp.hireDate,
              })),
              totalNewHires: newHires.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
