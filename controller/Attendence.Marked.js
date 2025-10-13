import { asyncHandler } from "../asyncHandler.js";
const AttendenceMarked= asyncHandler( async(req,res)=>{
    res.status(200).json({
        success:true,
        message:"Attendence Marked Successfully"
    })
   // const {name,email,url}=req.body
})
export {AttendenceMarked};