export const missingFieldsChecker = async (requiredFields) => {
  
return Object.entries(requiredFields)
  .filter(([key, value]) => !value) // check values  null , undefined , 0 , "" return that values
  .map(([key]) => key);
}