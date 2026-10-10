/** Preserve explicit partial quantities; full coverage needs an explicit basis. */
export function measuredDraftQuantity({quantity,unit,quantityBasis,roofArea,description,prompt}) {
 if(roofArea!==null&&Number.isFinite(roofArea)&&roofArea>0&&quantityBasis==="full_roof"&&!/\b(partial|patch|repair|damaged|section|portion|parcial|dañado|reparación)\b/i.test(`${description} ${prompt}`)){
  if(unit==="roofing square")return {quantity:Math.round(roofArea)/100,source:"contractor_measurement"};
  if(unit==="sq ft")return {quantity:roofArea,source:"contractor_measurement"};
 }
 return {quantity,source:"ai_estimated"};
}
