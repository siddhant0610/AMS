import { asyncHandler } from "../asyncHandler";
const AttendenceMarked= asyncHandler( async(req,res)=>{
     res.status(200).json({
        message:"Attendence Marked Successfully"
    })
})
export {AttendenceMarked};