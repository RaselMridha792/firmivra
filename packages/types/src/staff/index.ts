export * from './schemas.js';
export * from './departments.js';
export * from './roles.js';
export {
  createDepartmentsClient,
  createRolesClient,
  createStaffClient,
  type DepartmentsClient,
  type RolesClient,
  type StaffClient,
} from './client.js';
