/** Isolated Navigator password verification WITHOUT issuing any JWT.
 * Mirrors the established tenant-scoped app_users/bcrypt credential check.
 * Never use the normal loginUserByTenantSlug here: it issues a full token.
 */
import bcrypt from "bcryptjs"
import {pool} from "../db/db"
import {getTenantIdBySlug} from "./authService"
export async function verifyPashLocRestrictedCredentials(input:{
 tenantSlug:string;email:string;password:string
}):Promise<{tenantId:number;userId:number}|null>{
 if(typeof input.tenantSlug!=="string"||!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(input.tenantSlug)||
    typeof input.email!=="string"||input.email.length>254||
    typeof input.password!=="string"||!input.password||input.password.length>4096)return null
 const tenantId=await getTenantIdBySlug(input.tenantSlug)
 const result=await pool.query(
  `select id,password_hash from app_users
    where tenant_id=$1 and lower(email)=$2 and is_active=true limit 1`,
  [tenantId,input.email.trim().toLowerCase()]
 )
 if(result.rowCount!==1)return null
 if(!await bcrypt.compare(input.password,result.rows[0].password_hash))return null
 return {tenantId,userId:Number(result.rows[0].id)}
}
