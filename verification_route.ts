app.get("/api/auth/verify", async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token || typeof email !== 'string' || typeof token !== 'string') {
    return res.status(400).send("Invalid verification link.");
  }
  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      return res.status(400).send("User not found.");
    }
    if (user.isVerified) {
      return res.send("Account already verified. You can now log in.");
    }
    if (user.verificationToken !== token) {
      return res.status(400).send("Invalid verification token.");
    }
    await dbService.updateUser(user.id, { isVerified: true, verificationToken: undefined });
    res.send("Email verified successfully! You can now log in.");
  } catch (error) {
    res.status(500).send("Failed to verify email.");
  }
});
