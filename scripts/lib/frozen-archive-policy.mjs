const OVERRIDE_FLAG = "--override-fixed-archive";
const OVERRIDE_APPROVAL = "explicit-user-approved-archive-rewrite";

export function enforceFixedArchive(source) {
  const explicitlyApproved = process.argv.includes(OVERRIDE_FLAG)
    && process.env.DSH_FIXED_ARCHIVE_MUTATION_APPROVAL === OVERRIDE_APPROVAL;
  if (explicitlyApproved) return;
  throw new Error(
    `DSH ${source} 数据已固定封存；自动采集、同步、回填和重建均已停用。只有未来获得用户明确授权的代码发布，才能临时解除冻结。`,
  );
}
