// utils/cloudinary.js
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(buffer, { folder='farms', publicId } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,           // اختياري
        resource_type: 'image',
        // ضغط/تهيئة تلقائية + تحديد عرض أقصى (بدون تكبير):
        transformation: [
          { width: 1600, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" }
        ]
      },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

module.exports = { cloudinary, uploadBufferToCloudinary };
