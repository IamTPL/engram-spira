#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"

const SKILLS_DIR = ".agents/skills"
const LOCK_FILE = "skills-lock.json"

function computeHash(dirPath: string): string {
  let hash = createHash("sha256")
  
  function processFile(filePath: string) {
    const content = readFileSync(filePath, "utf8")
    hash.update(content)
  }
  
  function processDirectory(dirPath: string) {
    const items = readdirSync(dirPath).sort()
    
    for (const item of items) {
      const fullPath = join(dirPath, item)
      const stat = statSync(fullPath)
      
      if (stat.isDirectory()) {
        processDirectory(fullPath)
      } else {
        processFile(fullPath)
      }
    }
  }
  
  processDirectory(dirPath)
  return hash.digest("hex")
}

function updateSkillsLock() {
  console.log("🔍 Scanning skills directory...")
  
  const skillsDir = SKILLS_DIR
  const lockPath = LOCK_FILE
  
  // Read existing lock file
  let lockData: any = { version: 1, skills: {} }
  try {
    lockData = JSON.parse(readFileSync(lockPath, "utf8"))
  } catch (error) {
    console.log("📝 Creating new lock file...")
  }
  
  // Get all skill directories
  const skillDirs = readdirSync(skillsDir).filter(item => {
    const fullPath = join(skillsDir, item)
    return statSync(fullPath).isDirectory()
  })
  
  console.log(`📦 Found ${skillDirs.length} skills: ${skillDirs.join(", ")}`)
  
  // Update each skill
  for (const skillName of skillDirs) {
    const skillPath = join(skillsDir, skillName)
    const skillFile = join(skillPath, "SKILL.md")
    
    try {
      // Check if SKILL.md exists
      statSync(skillFile)
      
      // Compute hash
      const hash = computeHash(skillPath)
      
      // Read skill metadata
      const skillContent = readFileSync(skillFile, "utf8")
      const sourceMatch = skillContent.match(/source:\s*(.+)/)
      const sourceTypeMatch = skillContent.match(/sourceType:\s*(.+)/)
      
      const source = sourceMatch ? sourceMatch[1].trim() : `${skillName}/skills`
      const sourceType = sourceTypeMatch ? sourceTypeMatch[1].trim() : "github"
      
      // Update lock data
      lockData.skills[skillName] = {
        source,
        sourceType,
        computedHash: hash
      }
      
      console.log(`✅ Updated ${skillName}: ${hash.substring(0, 8)}...`)
    } catch (error) {
      console.log(`❌ Skipped ${skillName}: No SKILL.md found`)
    }
  }
  
  // Write updated lock file
  writeFileSync(lockPath, JSON.stringify(lockData, null, 2))
  console.log(`💾 Updated ${lockPath}`)
  console.log(`🎯 Locked ${Object.keys(lockData.skills).length} skills`)
}

if (import.meta.main) {
  updateSkillsLock()
}
