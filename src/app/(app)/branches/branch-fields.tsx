import { Input, Label, Select, Hint } from "@/components/ui/input";
import { BRANCH_STATUSES, BRANCH_STATUS_LABELS } from "@/types/enums";

// Shared field set for create/edit branch dialogs (server-rendered).
export function BranchFields({
  defaults,
}: {
  defaults?: {
    name?: string;
    code?: string;
    city?: string;
    status?: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bf-name" required>Branch name</Label>
          <Input id="bf-name" name="name" defaultValue={defaults?.name} placeholder="Branch name" required />
        </div>
        <div>
          <Label htmlFor="bf-code" required>Branch code</Label>
          <Input id="bf-code" name="code" defaultValue={defaults?.code} placeholder="e.g. BR-01" required />
          <Hint>Short unique identifier used in records and reports.</Hint>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bf-city" required>City</Label>
          <Input id="bf-city" name="city" defaultValue={defaults?.city} placeholder="City" required />
        </div>
        <div>
          <Label htmlFor="bf-status">Operating status</Label>
          <Select id="bf-status" name="status" defaultValue={defaults?.status ?? "OPERATING"}>
            {BRANCH_STATUSES.map((s) => (
              <option key={s} value={s}>{BRANCH_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="bf-address">Address</Label>
        <Input id="bf-address" name="address" defaultValue={defaults?.address ?? ""} placeholder="Street, district" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bf-phone">Phone</Label>
          <Input id="bf-phone" name="phone" defaultValue={defaults?.phone ?? ""} placeholder="+964 …" />
        </div>
        <div>
          <Label htmlFor="bf-email">Email</Label>
          <Input id="bf-email" name="email" type="email" defaultValue={defaults?.email ?? ""} placeholder="Branch email" />
        </div>
      </div>
    </>
  );
}
